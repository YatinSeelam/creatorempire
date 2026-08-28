import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { PersonAvatar, Thumb } from "@/components/dash/thumb";
import { Panel, Pill, Row } from "@/components/dash/ui";
import { AccessPicker } from "@/components/dash/access-picker";
import { ViewAsButton } from "@/components/dash/view-as";
import { accessOf } from "@/lib/access-levels";
import {
  loadPerson,
  personInitial,
  personName,
  type UgcItem,
  type UgcSource,
} from "@/lib/founder";
import { PLATFORMS, type Platform } from "@/lib/deals";
import { ago, money, shortDate, views as compactViews } from "@/lib/money";
import { ROLE_LABEL, type OrgRole } from "@/lib/org";
import { portfolioHref, portfolioUrl } from "@/lib/portfolio-schema";
import { requireFounderView } from "@/lib/supabase/founder";
import { microsToUsd } from "@/lib/usage-pricing";

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

/**
 * Platform strings reach this page from three tables and are not a closed set,
 * so they are narrowed before anything tries to draw a mark for one. Anything
 * unrecognised keeps its own word rather than being drawn as the wrong logo.
 */
function asPlatform(raw: string): Platform | null {
  const k = (raw ?? "").trim().toLowerCase();
  return (PLATFORMS as readonly string[]).includes(k) ? (k as Platform) : null;
}

/**
 * The mark, or the word when we do not have a mark for it.
 *
 * Spelling "TikTok" beside every handle costs a line of type to say what a
 * 15px logo says instantly, and this page had four of them on one row.
 */
function PlatformIcon({ raw, className = "size-[15px]" }: { raw: string; className?: string }) {
  const platform = asPlatform(raw);
  if (!platform) return <span className="text-[12px] text-ink-50">{raw || "?"}</span>;
  return <PlatformGlyph platform={platform} tone="brand" className={className} />;
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

  const { person, ugc, ugcHidden, usage, deals } = detail;
  const name = personName(person);
  const dealAccountCount = deals.reduce((n, d) => n + d.accounts.length, 0);

  // the seat they hold, read under the admin view, which the
  // `org_members_admin_read` policy answers to; nothing else in the app can see
  // somebody else's seats.
  //
  // one role, not a list of workspaces. this used to be a whole panel naming
  // every org they sat on with an address under each and a form to mint them
  // another. there is one workspace on this deploy, the addresses it printed
  // were hosts nothing answers on, and a second org buys its owner nothing
  // because the app is pinned to CE_ORG_ID. a word in the header says all of
  // it that was ever true.
  const { supabase } = await requireFounderView("/founder");
  const { data: seatRows } = await supabase
    .from("org_members")
    .select("role")
    .eq("user_id", id)
    .order("joined_at", { ascending: true })
    .limit(1);
  const seat = (seatRows?.[0]?.role ?? null) as OrgRole | null;

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
              {seat && <Pill tone="quiet">{ROLE_LABEL[seat]}</Pill>}
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
                  href={portfolioHref(person.portfolio_slug)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-flame transition-colors hover:text-flame-dark"
                >
                  {portfolioUrl(person.portfolio_slug)}
                  {person.portfolio_published ? "" : " (unpublished)"}
                </a>
              )}
            </div>
          </div>

          {/* what they can reach, and going and looking at it: the same job,
              so the picker and the swap sit together rather than the first one
              living on a tab of its own. */}
          <div className="flex shrink-0 items-center gap-2.5">
            <AccessPicker
              userId={person.user_id}
              email={person.email ?? ""}
              level={accessOf(person)}
            />
            <ViewAsButton userId={person.user_id} name={name} />
          </div>
        </div>
      </Panel>

      {/* 2. usage, one panel, four numbers */}
      <Panel
        title="Usage"
        action={
          <span className="text-[13px] font-semibold text-ink-50">
            {microsToUsd(person.spend_micros)} all in
          </span>
        }
      >
        {/* one line under each number, not three. the three said credits AND
            calls AND saved profiles, which is the ledger's job; what this panel
            is for is "is this person expensive", and that is the number. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UsageGroup
            label="Scraper"
            value={microsToUsd(usage.scrape.micros)}
            hint={
              usage.scrape.calls === 0
                ? "never run"
                : `${fmt(usage.scrape.credits)} credits`
            }
          />
          <UsageGroup
            label="AI flow"
            value={microsToUsd(usage.flow.micros)}
            hint={
              usage.flow.turns === 0
                ? "never used"
                : `${fmt(usage.flow.turns)} ${usage.flow.turns === 1 ? "turn" : "turns"}`
            }
          />
          <UsageGroup
            label="Account emails"
            value={fmt(usage.emails.addresses)}
            hint={
              usage.emails.addresses === 0
                ? "none made"
                : `${fmt(usage.emails.codes)} ${usage.emails.codes === 1 ? "code" : "codes"}`
            }
          />
          <UsageGroup
            label="Transcriber"
            value={fmt(usage.transcripts)}
            hint={usage.transcripts === 0 ? "never used" : "saved"}
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
            {dealAccountCount === 1 ? "account" : "accounts"}
          </span>
        }
      >
        {deals.length === 0 ? (
          <Empty>No deals yet.</Empty>
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
                {/* paused is drawn rather than spelled: a dimmed row of marks
                    says which account is off without " (paused)" after each. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {d.accounts.length === 0 ? (
                    <span className="text-[13px] text-ink-50">no accounts</span>
                  ) : (
                    d.accounts.map((a) => (
                      <span
                        key={`${a.platform}-${a.handle}`}
                        title={a.active ? undefined : "paused"}
                        className={`inline-flex items-center gap-1.5 text-[13px] ${
                          a.active ? "text-ink-70" : "opacity-40"
                        }`}
                      >
                        <PlatformIcon raw={a.platform} />
                        <span className="truncate">@{a.handle}</span>
                      </span>
                    ))
                  )}
                </div>
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
          <Empty>Nothing posted, scraped or tracked yet.</Empty>
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

/** One of the four usage numbers: the tool, what it cost, one line of how. */
function UsageGroup({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[12px] border border-line bg-shell px-4 py-4">
      <p className="text-[12.5px] font-semibold text-ink-50">{label}</p>
      <p className="mt-1.5 text-[22px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-[12.5px] text-ink-50">{hint}</p>
    </div>
  );
}

/**
 * One post. The cover is the point, so it is the whole top of the card, and the
 * two chips ride on it rather than adding lines under it: where the post came
 * from on the left, whose platform it is on the right, as its own mark. Under
 * the cover is the title and the one number anybody reads a post for.
 */
function UgcCard({ item }: { item: UgcItem }) {
  const body = (
    <>
      <span className="relative block">
        <Thumb
          src={item.thumbnail}
          fallback={(item.platform || "?").slice(0, 1).toUpperCase()}
          className="block h-[168px] w-full rounded-[10px]"
        />
        <span className="absolute left-2 top-2 inline-flex items-center rounded-pill bg-ink/85 px-2.5 py-1 text-[11.5px] font-semibold text-white">
          {SOURCE_LABEL[item.source]}
        </span>
        <span className="absolute right-2 top-2 inline-flex items-center rounded-pill bg-paper/90 p-1.5">
          <PlatformIcon raw={item.platform} className="size-[14px]" />
        </span>
      </span>

      <span className="mt-2.5 block truncate text-[14px] font-semibold tracking-[-0.01em]">
        {item.title}
      </span>

      <span className="mt-1 block truncate text-[12.5px] text-ink-50">
        {item.views !== null ? `${compactViews(item.views)} views` : "no views yet"}
        {item.postedAt ? ` · ${ago(item.postedAt)}` : ""}
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

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-5 py-10 text-center text-[13.5px] text-ink-50">{children}</p>
  );
}
