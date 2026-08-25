import type { Metadata } from "next";
import Link from "next/link";
import {
  CapControls,
  type Override,
  type Person,
} from "@/components/dash/usage-controls";
import { Panel, Pill, Row, Stat } from "@/components/dash/ui";
import { ago, shortDate } from "@/lib/money";
import { compactCount } from "@/lib/scrape/types";
import { getPricing } from "@/lib/scrape/usage";
import { requireFounderView } from "@/lib/supabase/founder";
import { flowCostMicros, microsToUsd } from "@/lib/usage-pricing";

export const metadata: Metadata = {
  title: "Usage · Creator Empire",
  robots: { index: false },
};

const PROVIDER = "scrapecreators";

/**
 * How many ledger rows one render reads, per ledger. The rollups below are
 * grouped in js rather than sql because both ledgers are a few hundred rows and
 * a `group by` view is a migration this page does not own. Past roughly 100k
 * rows that stops being true: move the rollups into a view then, and this cap
 * goes with them. Until then the page says out loud when it hits the cap rather
 * than quietly adding up a slice.
 */
const EVENT_LIMIT = 5000;

/** Newest calls on one person's detail. Printed in the ui, never silent. */
const DETAIL_LIMIT = 200;

/** Accounts offered in the cap picker. Same honesty rule as above. */
const PEOPLE_LIMIT = 200;

/** Rows read per tools table for the lifetime counts. */
const TOOL_LIMIT = 10_000;

/**
 * Rows read for the credits section. One query covers this calendar month and
 * the last 14 days, whichever reaches further back, so the balance, the runway
 * and the two source splits all add up the same rows. Same honesty rule as the
 * caps above: the page says when it hit the cap rather than quietly reporting a
 * slice as the whole month.
 */
const SPEND_LIMIT = 20_000;

/** Under this the page stops being a report and starts being a warning. */
const LOW_BALANCE = 100;

/**
 * Days the runway averages over. Long enough that one heavy backfill does not
 * set the pace, short enough that last month's shape does not either.
 */
const RUNWAY_DAYS = 14;

/** Newest failures listed. Enough to see a pattern, not enough to be a log. */
const FAILURE_LIMIT = 10;

const TOP_UP_URL = "https://app.scrapecreators.com";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

const DEFAULT_RANGE: RangeKey = "30d";

/**
 * Everything is cut on utc day boundaries, the same way `today()` in lib/money
 * does it, so a total on this page and a snapshot date in the tracker can never
 * disagree about which day a call landed on. "7 days" is today plus the six
 * before it, which is what a person means when they say the last week.
 */
function rangeStart(key: RangeKey, now: Date): string | null {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  if (key === "today") return new Date(Date.UTC(y, m, d)).toISOString();
  if (key === "7d") return new Date(Date.UTC(y, m, d - 6)).toISOString();
  if (key === "30d") return new Date(Date.UTC(y, m, d - 29)).toISOString();
  if (key === "month") return new Date(Date.UTC(y, m, 1)).toISOString();
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmt = (n: number) => n.toLocaleString("en-US");

/** Whole percents once it is loud enough to matter, one decimal under ten. */
function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const v = (part / whole) * 100;
  return `${v === 0 || v >= 10 ? Math.round(v) : v.toFixed(1)}%`;
}

type Event = {
  id: number;
  user_id: string | null;
  user_email: string | null;
  endpoint: string;
  platform: string | null;
  credits_charged: number;
  cached: boolean;
  ok: boolean;
  status_code: number | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
};

/** The credits section reads its own narrow row: enough to split a total three
 *  ways and put a name on it, nothing else. */
type SpendRow = {
  user_id: string | null;
  user_email: string | null;
  source: string | null;
  credits_charged: number;
  ok: boolean;
  created_at: string;
};

type Failure = {
  id: number;
  endpoint: string;
  platform: string | null;
  source: string | null;
  status_code: number | null;
  error: string | null;
  created_at: string;
};

/** sync is the nightly cron, manual is a refresh button, tool is the tools
 *  section. Every credit spent lands in exactly one of the three. */
type Split = { sync: number; manual: number; tool: number };

type SourceKey = keyof Split;

const emptySplit = (): Split => ({ sync: 0, manual: 0, tool: 0 });
const splitTotal = (s: Split) => s.sync + s.manual + s.tool;

/**
 * Rows written before the column existed carry the db default, and anything the
 * app has not heard of is counted as a tool call rather than dropped: a credit
 * that was spent has to land somewhere on this page.
 */
function sourceOf(value: string | null): SourceKey {
  return value === "sync" || value === "manual" ? value : "tool";
}

/** A provider message can be a whole html page. The ledger already cuts it at
 *  500 chars; a row in a list wants far less than that. */
function clip(text: string | null, max = 120): string {
  if (!text) return "no message";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

type PersonMonth = {
  userId: string | null;
  email: string;
  split: Split;
  total: number;
  calls: number;
  fails: number;
  last: string;
};

type UserRoll = {
  userId: string | null;
  email: string;
  credits: number;
  calls: number;
  fails: number;
  cached: number;
  last: string;
};

type FlowRoll = {
  userId: string;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  micros: number;
};

type ToolRoll = {
  userId: string;
  addresses: number;
  accounts: number;
  codes: number;
  transcripts: number;
};

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; user?: string }>;
}) {
  // this page gates itself rather than leaning on the (dash) layout, because
  // CLAUDE.md says that gate is going to open to paying subscribers and this
  // page must not open with it. The admin layout checks too; both are cheap and
  // a server component is its own entry point.
  const { supabase } = await requireFounderView("/founder/usage");

  const params = await searchParams;
  const range: RangeKey =
    (RANGES.find((r) => r.key === params.range)?.key as RangeKey) ??
    DEFAULT_RANGE;
  const focus = params.user && UUID.test(params.user) ? params.user : null;

  const now = new Date();
  const since = rangeStart(range, now);

  // the credits section is deliberately not a range question. "are we about to
  // run out" is always about today, this calendar month and the last fortnight,
  // whatever window the tables further down happen to be showing. all three cut
  // on utc day boundaries, the same way rangeStart() does.
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const dy = now.getUTCDate();

  const todayMs = Date.UTC(y, mo, dy);
  const monthMs = Date.UTC(y, mo, 1);
  const runwayMs = Date.UTC(y, mo, dy - (RUNWAY_DAYS - 1));

  // one read serves all three windows, so it starts at whichever reaches back
  // furthest: early in the month that is the runway, late in it the 1st.
  const spendSince = new Date(Math.min(monthMs, runwayMs)).toISOString();

  const rangeLabel =
    RANGES.find((r) => r.key === range)?.label.toLowerCase() ?? "";

  // ------------------------------------------------------------ the reads

  let ledgerQuery = supabase
    .from("api_usage_events")
    .select(
      "id,user_id,user_email,endpoint,platform,credits_charged,cached,ok,status_code,error,duration_ms,created_at"
    )
    .eq("provider", PROVIDER)
    .order("created_at", { ascending: false })
    .limit(EVENT_LIMIT);

  if (since) ledgerQuery = ledgerQuery.gte("created_at", since);

  let flowQuery = supabase
    .from("ai_usage_events")
    .select(
      "user_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, ok, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(EVENT_LIMIT);

  if (since) flowQuery = flowQuery.gte("created_at", since);

  const [
    pricing,
    { data: ledger },
    { data: flowLedger },
    { data: balanceRow },
    { data: limitRows },
    { data: people },
    { data: emailRows },
    { data: emailAccountRows },
    { data: messageRows },
    { data: transcriptRows },
    { data: spendRows },
    { data: failureRows },
  ] = await Promise.all([
    getPricing(),
    ledgerQuery,
    flowQuery,
    // the provider's own balance is not a range question. it is whatever the
    // last call was told, whenever that was.
    supabase
      .from("api_usage_events")
      .select("credits_remaining, created_at")
      .not("credits_remaining", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("api_user_limits")
      .select("user_id, daily_credit_cap, note")
      .order("updated_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, email, full_name")
      .order("created_at", { ascending: false })
      .limit(PEOPLE_LIMIT),
    supabase.from("account_emails").select("user_id").limit(TOOL_LIMIT),
    supabase.from("account_email_accounts").select("user_id").limit(TOOL_LIMIT),
    supabase.from("account_email_messages").select("user_id").limit(TOOL_LIMIT),
    supabase.from("transcripts").select("user_id").limit(TOOL_LIMIT),
    // the credits section, in one read. grouped in js below for the same reason
    // everything else on this page is: a `group by` view is a migration this
    // page does not own, and a month of calls is thousands of rows, not
    // millions. `source` is what makes the split possible at all.
    supabase
      .from("api_usage_events")
      .select("user_id,user_email,source,credits_charged,ok,created_at")
      .eq("provider", PROVIDER)
      .gte("created_at", spendSince)
      .order("created_at", { ascending: false })
      .limit(SPEND_LIMIT),
    // failures are not a range question either. a wall of them is a broken
    // handle burning money and it has to be visible on arrival, not after
    // somebody widens a picker.
    supabase
      .from("api_usage_events")
      .select("id,endpoint,platform,source,status_code,error,created_at")
      .eq("provider", PROVIDER)
      .eq("ok", false)
      .order("created_at", { ascending: false })
      .limit(FAILURE_LIMIT),
  ]);

  // pricing comes out of code now, so a credit always has a real dollar price
  // and nothing on this page is allowed to read "not set".
  const micros = pricing.microsPerCredit;
  const usd = (credits: number) => microsToUsd(credits * micros);

  const events = (ledger ?? []) as Event[];
  const truncated = events.length >= EVENT_LIMIT;

  const nameById = new Map<string, { name: string; email: string }>();
  for (const p of people ?? []) {
    nameById.set(p.id, {
      name: (p.full_name ?? "").trim(),
      email: (p.email ?? "").trim(),
    });
  }

  const label = (userId: string) => {
    const who = nameById.get(userId);
    return who?.name || who?.email || "Unknown";
  };

  // --------------------------------------------------- scraping rollups

  let totalCredits = 0;
  let totalFails = 0;
  let totalCached = 0;

  const byUser = new Map<string, UserRoll>();
  const byEndpoint = new Map<
    string,
    { endpoint: string; credits: number; calls: number; fails: number }
  >();

  for (const e of events) {
    totalCredits += e.credits_charged;
    if (!e.ok) totalFails += 1;
    if (e.cached) totalCached += 1;

    // the ledger keeps user_email denormalised on purpose: user_id goes null
    // when an account is deleted, and last month's cost still has to have a
    // name on it. so the key falls back to the email, then to one bucket.
    const email = (e.user_email ?? "").trim();
    const key = e.user_id ?? (email ? `email:${email}` : "unknown");

    const roll = byUser.get(key);
    if (roll) {
      roll.credits += e.credits_charged;
      roll.calls += 1;
      if (!e.ok) roll.fails += 1;
      if (e.cached) roll.cached += 1;
      if (e.created_at > roll.last) roll.last = e.created_at;
    } else {
      byUser.set(key, {
        userId: e.user_id,
        email,
        credits: e.credits_charged,
        calls: 1,
        fails: e.ok ? 0 : 1,
        cached: e.cached ? 1 : 0,
        last: e.created_at,
      });
    }

    const ep = byEndpoint.get(e.endpoint);
    if (ep) {
      ep.credits += e.credits_charged;
      ep.calls += 1;
      if (!e.ok) ep.fails += 1;
    } else {
      byEndpoint.set(e.endpoint, {
        endpoint: e.endpoint,
        credits: e.credits_charged,
        calls: 1,
        fails: e.ok ? 0 : 1,
      });
    }
  }

  const userRows = [...byUser.values()].sort((a, b) => b.credits - a.credits);
  const endpointRows = [...byEndpoint.values()].sort(
    (a, b) => b.credits - a.credits
  );

  const balance = balanceRow?.credits_remaining ?? null;

  // ------------------------------------------------ credits, runway, source

  const spend = (spendRows ?? []) as SpendRow[];
  const spendTruncated = spend.length >= SPEND_LIMIT;

  const todaySplit = emptySplit();
  const monthSplit = emptySplit();
  const byPerson = new Map<string, PersonMonth>();

  let runwayCredits = 0;
  const runwayDays = new Set<string>();

  for (const r of spend) {
    // parsed rather than string-compared: the ledger renders its timestamps
    // with an offset and these boundaries are built with a Z, so the two are
    // only reliably ordered as instants.
    const at = Date.parse(r.created_at);
    const key = sourceOf(r.source);
    const credits = r.credits_charged ?? 0;

    if (at >= runwayMs) {
      runwayCredits += credits;
      runwayDays.add(r.created_at.slice(0, 10));
    }

    if (at >= todayMs) todaySplit[key] += credits;
    if (at < monthMs) continue;

    monthSplit[key] += credits;

    // same key rule as the range table above: user_id goes null when an account
    // is deleted, and this month's cost still has to have a name on it.
    const email = (r.user_email ?? "").trim();
    const who = r.user_id ?? (email ? `email:${email}` : "unknown");

    let roll = byPerson.get(who);
    if (!roll) {
      roll = {
        userId: r.user_id,
        email,
        split: emptySplit(),
        total: 0,
        calls: 0,
        fails: 0,
        last: r.created_at,
      };
      byPerson.set(who, roll);
    }

    roll.split[key] += credits;
    roll.total += credits;
    roll.calls += 1;
    if (!r.ok) roll.fails += 1;
    if (r.created_at > roll.last) roll.last = r.created_at;
  }

  const monthPeople = [...byPerson.values()].sort((a, b) => b.total - a.total);
  const monthTotal = splitTotal(monthSplit);
  const todayTotal = splitTotal(todaySplit);

  // days with data, not calendar days. a deploy three days old must not report
  // a fortnight's pace off three days of spending, and a sync that only runs
  // every third day would otherwise read as a third of its real burn.
  const perDay = runwayDays.size > 0 ? runwayCredits / runwayDays.size : 0;
  const daysLeft =
    balance != null && perDay > 0 ? Math.floor(balance / perDay) : null;
  const lowBalance = balance != null && balance < LOW_BALANCE;

  const failures = (failureRows ?? []) as Failure[];

  // ---------------------------------------------------- ai flow rollups

  const flowByUser = new Map<string, FlowRoll>();
  let flowTurns = 0;
  let flowTokensIn = 0;
  let flowTokensOut = 0;
  let flowMicros = 0;

  for (const r of flowLedger ?? []) {
    const rowMicros = flowCostMicros(r.model, r);
    flowTurns += 1;
    flowTokensIn += r.input_tokens;
    flowTokensOut += r.output_tokens;
    flowMicros += rowMicros;

    const roll = flowByUser.get(r.user_id);
    if (roll) {
      roll.turns += 1;
      roll.tokensIn += r.input_tokens;
      roll.tokensOut += r.output_tokens;
      roll.micros += rowMicros;
    } else {
      flowByUser.set(r.user_id, {
        userId: r.user_id,
        turns: 1,
        tokensIn: r.input_tokens,
        tokensOut: r.output_tokens,
        micros: rowMicros,
      });
    }
  }

  const flowRows = [...flowByUser.values()].sort((a, b) => b.micros - a.micros);
  const flowTruncated = (flowLedger ?? []).length >= EVENT_LIMIT;

  // ------------------------------------------------------ tools rollups

  const toolsByUser = new Map<string, ToolRoll>();
  const tool = (userId: string) => {
    let roll = toolsByUser.get(userId);
    if (!roll) {
      roll = { userId, addresses: 0, accounts: 0, codes: 0, transcripts: 0 };
      toolsByUser.set(userId, roll);
    }
    return roll;
  };

  for (const r of emailRows ?? []) tool(r.user_id).addresses += 1;
  for (const r of emailAccountRows ?? []) tool(r.user_id).accounts += 1;
  for (const r of messageRows ?? []) tool(r.user_id).codes += 1;
  for (const r of transcriptRows ?? []) tool(r.user_id).transcripts += 1;

  const toolRows = [...toolsByUser.values()].sort(
    (a, b) =>
      b.addresses + b.accounts + b.transcripts -
      (a.addresses + a.accounts + a.transcripts)
  );

  // ---------------------------------------------------------- the detail

  let detailCalls: Event[] = [];
  let detailTargets: {
    id: string;
    platform: string;
    handle: string;
    profile_url: string;
    credits_spent: number;
    pages_fetched: number;
    last_scraped_at: string | null;
  }[] = [];

  if (focus) {
    let callsQuery = supabase
      .from("api_usage_events")
      .select(
        "id,user_id,user_email,endpoint,platform,credits_charged,cached,ok,status_code,error,duration_ms,created_at"
      )
      .eq("user_id", focus)
      .order("created_at", { ascending: false })
      .limit(DETAIL_LIMIT);

    if (since) callsQuery = callsQuery.gte("created_at", since);

    const [{ data: calls }, { data: targets }] = await Promise.all([
      callsQuery,
      supabase
        .from("scrape_targets")
        .select(
          "id, platform, handle, profile_url, credits_spent, pages_fetched, last_scraped_at"
        )
        .eq("user_id", focus)
        .order("credits_spent", { ascending: false })
        .limit(50),
    ]);

    detailCalls = (calls ?? []) as Event[];
    detailTargets = targets ?? [];
  }

  const focusPerson = focus ? nameById.get(focus) : undefined;
  const focusLabel =
    focusPerson?.name ||
    focusPerson?.email ||
    userRows.find((r) => r.userId === focus)?.email ||
    "This account";

  // ------------------------------------------------------------ the cap

  const pickable: Person[] = (people ?? []).map((p) => ({
    id: p.id,
    label: (p.full_name ?? "").trim()
      ? `${(p.full_name ?? "").trim()} · ${p.email ?? "no email"}`
      : (p.email ?? p.id),
  }));

  const overrides: Override[] = (limitRows ?? []).map((l) => {
    const who = nameById.get(l.user_id);
    return {
      userId: l.user_id,
      label: who?.name || who?.email || l.user_id,
      cap: l.daily_credit_cap,
      note: l.note,
    };
  });

  const href = (next: { range?: RangeKey; user?: string | null }) => {
    const q = new URLSearchParams();
    const r = next.range ?? range;
    if (r !== DEFAULT_RANGE) q.set("range", r);
    const u = next.user === undefined ? focus : next.user;
    if (u) q.set("user", u);
    const s = q.toString();
    return s ? `/founder/usage?${s}` : "/founder/usage";
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ 0. credits left */}
      <SectionHead
        title="Credits left"
        note="the question this page exists for. always live, never scoped to the range picker below."
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr]">
        {/* the balance is the headline, so it is a card of its own rather than
            a fifth stat in a row of five. */}
        <div className="rounded-card border border-line bg-paper px-5 py-[18px] shadow-card">
          <p className="text-[13px] font-semibold">Balance</p>
          <p
            className={`mt-2.5 font-extrabold leading-none tracking-[-0.035em] tabular-nums ${
              balance == null ? "text-[22px]" : "text-[44px]"
            }`}
          >
            {balance == null ? "no calls made yet" : fmt(balance)}
          </p>
          <p className="mt-2 text-[12.5px] leading-[1.45] text-ink-50">
            {balance == null
              ? "scrapecreators reports its balance on every call it answers, so this fills itself in the first time the scraper runs"
              : `${usd(balance)} of credit · scrapecreators own count, ${ago(balanceRow?.created_at)}`}
          </p>
        </div>

        <Stat
          label="Burn rate"
          value={perDay > 0 ? `${fmt(Math.round(perDay))}/day` : "nothing yet"}
          note={
            perDay > 0
              ? `${fmt(runwayCredits)} credits over ${runwayDays.size} ${
                  runwayDays.size === 1 ? "day" : "days"
                } with calls, in the last ${RUNWAY_DAYS}`
              : `no credits spent in the last ${RUNWAY_DAYS} days`
          }
        />

        <Stat
          label="Runway"
          value={daysLeft == null ? "unknown" : `about ${fmt(daysLeft)} days`}
          note={
            daysLeft != null
              ? "left at this pace"
              : balance == null
                ? "no balance reported yet, so there is nothing to divide"
                : "nothing spent lately, so there is no pace to divide by"
          }
        />
      </div>

      {lowBalance && (
        <div className="rounded-card border border-line bg-ember px-5 py-4">
          <p className="text-[15px] font-bold tracking-[-0.015em] text-flame-dark">
            scraping credits are nearly out, top up at{" "}
            <a
              href={TOP_UP_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              scrapecreators.com
            </a>
          </p>
          <p className="mt-1 max-w-[68ch] text-[13.5px] leading-[1.6] text-ink-70">
            {fmt(balance ?? 0)} credits left, {usd(balance ?? 0)} of scraping. at
            zero the nightly sync stops writing view counts and every earnings
            figure on the product quietly goes stale instead of failing loudly.
          </p>
        </div>
      )}

      {spendTruncated && (
        <p className="text-[13.5px] leading-[1.6] text-flame-dark">
          This month holds more than {fmt(SPEND_LIMIT)} calls. The splits and the
          table under them add up the newest {fmt(SPEND_LIMIT)} only, so they are
          a floor, not the whole bill.
        </p>
      )}

      <Panel
        title="Where the credits go"
        sub="sync is the nightly cron, manual is the refresh buttons, tool is the tools section"
        padded={false}
      >
        <SplitRow
          head="Today"
          note={`since midnight utc · ${fmt(todayTotal)} credits so far`}
          split={todaySplit}
          usd={usd}
        />
        <SplitRow
          head="This month"
          note={`since the 1st, utc · ${fmt(monthTotal)} credits`}
          split={monthSplit}
          usd={usd}
        />
      </Panel>

      <Panel
        title="Who spent it this month"
        padded={false}
        action={
          <span className="text-[13px] text-ink-50">
            {monthPeople.length}{" "}
            {monthPeople.length === 1 ? "account" : "accounts"}
          </span>
        }
      >
        {monthPeople.length === 0 ? (
          <Empty
            head="Nobody has spent a credit this month."
            body="Every outbound call writes a row here, whether it worked or not. An empty table means the scraper has not run this month, not that it ran for free."
          />
        ) : (
          monthPeople.map((r) => {
            const who = r.userId ? nameById.get(r.userId) : undefined;
            const name = who?.name || who?.email || r.email || "Unknown";
            const sub = who?.email && who?.name ? who.email : r.email;

            const body = (
              <>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <p className="text-[15px] font-bold tracking-[-0.015em]">
                    {name}
                  </p>
                  {!r.userId && <Pill tone="line">Deleted account</Pill>}
                  {r.calls > 1 && r.fails === r.calls && (
                    <Pill tone="flame">Every call failing</Pill>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[13.5px] text-ink-50">
                  {sub || "no email on the ledger"} · last activity {ago(r.last)}
                </p>
              </>
            );

            return (
              <Row key={r.userId ?? r.email ?? "unknown"}>
                {r.userId ? (
                  <Link
                    href={href({ user: r.userId === focus ? null : r.userId })}
                    className="min-w-0 flex-1 py-0.5"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1 py-0.5">{body}</div>
                )}

                <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
                  <Cell value={fmt(r.split.sync)} label="sync" />
                  <Cell value={fmt(r.split.manual)} label="manual" />
                  <Cell value={fmt(r.split.tool)} label="tool" />
                  <Cell value={fmt(r.total)} label="total" />
                  <Cell value={usd(r.total)} label="cost" />
                  <Cell
                    value={fmt(r.fails)}
                    label="failed"
                    tone={r.fails > 0 ? "bad" : undefined}
                  />
                </div>
              </Row>
            );
          })
        )}
      </Panel>

      <Panel
        title="Recent failures"
        sub="the last ten calls that did not work, whatever the range picker says"
        padded={false}
      >
        {failures.length === 0 ? (
          <Empty
            head="no failed calls"
            body="Nothing in the ledger came back broken. A wall of failures here is a handle the platform stopped answering for, and it burns credits at the same rate as a working one."
          />
        ) : (
          failures.map((f) => (
            <Row key={f.id}>
              <div className="min-w-0 flex-1 py-0.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <p className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">
                    {f.endpoint}
                  </p>
                  {f.platform && <Pill tone="quiet">{f.platform}</Pill>}
                  <Pill tone="line">{sourceOf(f.source)}</Pill>
                  <Pill tone="flame">
                    {f.status_code ? `http ${f.status_code}` : "no response"}
                  </Pill>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-ink-50">
                  {shortDate(f.created_at)} · {ago(f.created_at)} ·{" "}
                  {clip(f.error)}
                </p>
              </div>
            </Row>
          ))
        )}
      </Panel>

      {/* the date range. plain links, read server side, no client state.
          it scopes scraping and ai flow; the tools counts are lifetime, and
          the credits section above is always live. */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {RANGES.map((r) => {
          const on = r.key === range;
          return (
            <Link
              key={r.key}
              href={href({ range: r.key })}
              aria-current={on ? "page" : undefined}
              className={`rounded-pill px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                on
                  ? "bg-flame text-on-accent"
                  : "border border-line text-ink-70 hover:text-ink"
              }`}
            >
              {r.label}
            </Link>
          );
        })}
      </div>

      {/* ---------------------------------------------------- 1. scraping */}
      <SectionHead
        title="Scraping"
        note={`what the profile scraper and the nightly sync cost, in the last ${rangeLabel}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Credits burned"
          value={fmt(totalCredits)}
          note={`in the last ${rangeLabel}`}
        />
        <Stat
          label="Cost"
          value={usd(totalCredits)}
          note={`at ${usd(1)} a credit`}
        />
        <Stat
          label="Calls"
          value={fmt(events.length)}
          note={
            totalCached > 0
              ? `${fmt(totalCached)} served from cache`
              : "none served from cache"
          }
        />
        <Stat
          label="Failure rate"
          value={events.length === 0 ? "no calls" : pct(totalFails, events.length)}
          note={
            events.length === 0
              ? "nothing logged in this range"
              : `${fmt(totalFails)} of ${fmt(events.length)} failed`
          }
        />
        <Stat
          label="Provider balance"
          value={balance == null ? "not reported" : compactCount(balance)}
          note={
            balance == null
              ? "scrapecreators has not sent a balance yet"
              : `scrapecreators own count, ${ago(balanceRow?.created_at)}`
          }
        />
      </div>

      {truncated && (
        <p className="text-[13.5px] leading-[1.6] text-flame-dark">
          This range holds more than {fmt(EVENT_LIMIT)} calls. Everything below
          adds up the newest {fmt(EVENT_LIMIT)} only, so the totals are a floor,
          not the whole bill. Narrow the range to get an exact number.
        </p>
      )}

      <Panel
        title="Cost per person"
        padded={false}
        action={
          <span className="text-[13px] text-ink-50">
            {userRows.length} {userRows.length === 1 ? "account" : "accounts"}
          </span>
        }
      >
        {userRows.length === 0 ? (
          <Empty
            head="Nobody has spent a credit in this range."
            body="Every outbound call to scrapecreators writes a row here, whether it worked or not. An empty table means the scraper has not run, not that it ran for free."
          />
        ) : (
          userRows.map((r) => {
            const who = r.userId ? nameById.get(r.userId) : undefined;
            const name = who?.name || who?.email || r.email || "Unknown";
            const sub = who?.email && who?.name ? who.email : r.email;

            const body = (
              <>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <p className="text-[15px] font-bold tracking-[-0.015em]">
                    {name}
                  </p>
                  {!r.userId && <Pill tone="line">Deleted account</Pill>}
                  {r.userId === focus && <Pill tone="flame">Open below</Pill>}
                </div>
                <p className="mt-0.5 truncate text-[13.5px] text-ink-50">
                  {sub || "no email on the ledger"} · last call {ago(r.last)}
                </p>
              </>
            );

            return (
              <Row key={r.userId ?? r.email ?? "unknown"}>
                {r.userId ? (
                  <Link
                    href={href({ user: r.userId === focus ? null : r.userId })}
                    className="min-w-0 flex-1 py-0.5"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1 py-0.5">{body}</div>
                )}

                <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
                  <Cell value={fmt(r.credits)} label="credits" />
                  <Cell value={usd(r.credits)} label="cost" />
                  <Cell value={fmt(r.calls)} label="calls" />
                  <Cell
                    value={fmt(r.fails)}
                    label="failed"
                    tone={r.fails > 0 ? "bad" : undefined}
                  />
                </div>
              </Row>
            );
          })
        )}
      </Panel>

      {/* one person, in detail */}
      {focus && (
        <>
          <Panel
            title={`${focusLabel} · recent calls`}
            padded={false}
            action={
              <Link
                href={href({ user: null })}
                className="text-[13px] font-semibold text-ink-50 transition-colors hover:text-flame-dark"
              >
                Close
              </Link>
            }
          >
            {detailCalls.length === 0 ? (
              <Empty
                head="No calls from this account in this range."
                body="Try a wider range. The ledger keeps every call forever, this view is just the window you picked."
              />
            ) : (
              <>
                {detailCalls.map((c) => (
                  <Row key={c.id}>
                    <div className="min-w-0 flex-1 py-0.5">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <p className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">
                          {c.endpoint}
                        </p>
                        {c.platform && <Pill tone="quiet">{c.platform}</Pill>}
                        {c.cached && <Pill tone="line">Cached</Pill>}
                        {!c.ok && <Pill tone="flame">Failed</Pill>}
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-ink-50">
                        {shortDate(c.created_at)} · {ago(c.created_at)}
                        {c.status_code ? ` · http ${c.status_code}` : ""}
                        {c.duration_ms ? ` · ${fmt(c.duration_ms)}ms` : ""}
                        {c.error ? ` · ${c.error}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
                      <Cell value={fmt(c.credits_charged)} label="credits" />
                      <Cell value={usd(c.credits_charged)} label="cost" />
                    </div>
                  </Row>
                ))}
                <p className="px-5 py-3.5 text-[13px] text-ink-50 sm:px-6">
                  {detailCalls.length >= DETAIL_LIMIT
                    ? `Newest ${DETAIL_LIMIT} calls in this range. There are older ones this list does not show.`
                    : `All ${detailCalls.length} of their calls in this range.`}
                </p>
              </>
            )}
          </Panel>

          <Panel
            title={`${focusLabel} · profiles pulled`}
            padded={false}
            action={
              <span className="text-[13px] text-ink-50">
                Lifetime, not this range
              </span>
            }
          >
            {detailTargets.length === 0 ? (
              <Empty
                head="No saved profiles."
                body="A call can fail before it ever gets far enough to save a target, so credits with nothing here usually means the scrapes did not land."
              />
            ) : (
              detailTargets.map((t) => (
                <Row key={t.id}>
                  <div className="min-w-0 flex-1 py-0.5">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <a
                        href={t.profile_url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-[14.5px] font-semibold tracking-[-0.01em] hover:text-flame"
                      >
                        @{t.handle}
                      </a>
                      <Pill tone="quiet">{t.platform}</Pill>
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-50">
                      {t.pages_fetched} {t.pages_fetched === 1 ? "page" : "pages"}{" "}
                      · last pulled{" "}
                      {t.last_scraped_at ? ago(t.last_scraped_at) : "never"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
                    <Cell value={fmt(t.credits_spent)} label="credits" />
                    <Cell value={usd(t.credits_spent)} label="cost" />
                  </div>
                </Row>
              ))
            )}
          </Panel>
        </>
      )}

      <Panel title="Cost by endpoint" padded={false}>
        {endpointRows.length === 0 ? (
          <Empty
            head="No endpoints called in this range."
            body="This is where an expensive platform gives itself away, once there is anything to add up."
          />
        ) : (
          endpointRows.map((e) => (
            <Row key={e.endpoint}>
              <div className="min-w-0 flex-1 py-0.5">
                <p className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">
                  {e.endpoint}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-50">
                  {pct(e.credits, totalCredits)} of the credits in this range
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
                <Cell value={fmt(e.credits)} label="credits" />
                <Cell value={usd(e.credits)} label="cost" />
                <Cell value={fmt(e.calls)} label="calls" />
                <Cell
                  value={fmt(e.fails)}
                  label="failed"
                  tone={e.fails > 0 ? "bad" : undefined}
                />
              </div>
            </Row>
          ))
        )}
      </Panel>

      {/* ----------------------------------------------------- 2. ai flow */}
      <SectionHead
        title="AI flow"
        note={`what the flow chat cost in tokens, in the last ${rangeLabel}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Turns"
          value={fmt(flowTurns)}
          note={`in the last ${rangeLabel}`}
        />
        <Stat label="Tokens in" value={compactCount(flowTokensIn)} note="prompt side, cache reads not counted here" />
        <Stat label="Tokens out" value={compactCount(flowTokensOut)} note="what the model wrote back" />
        <Stat
          label="Cost"
          value={microsToUsd(flowMicros)}
          note="tokens priced per model, in code"
        />
      </div>

      {flowTruncated && (
        <p className="text-[13.5px] leading-[1.6] text-flame-dark">
          This range holds more than {fmt(EVENT_LIMIT)} turns. The totals above
          add up the newest {fmt(EVENT_LIMIT)} only. Narrow the range to get an
          exact number.
        </p>
      )}

      <Panel
        title="Flow cost per person"
        padded={false}
        action={
          <span className="text-[13px] text-ink-50">
            {flowRows.length} {flowRows.length === 1 ? "account" : "accounts"}
          </span>
        }
      >
        {flowRows.length === 0 ? (
          <Empty
            head="Nobody has used the flow chat in this range."
            body="Every chat turn writes a row with its token counts, whether it worked or not. An empty table means the chat has not been used, not that it ran for free."
          />
        ) : (
          flowRows.map((r) => (
            <Row key={r.userId}>
              <Link
                href={`/founder/people/${r.userId}`}
                className="min-w-0 flex-1 py-0.5"
              >
                <p className="text-[15px] font-bold tracking-[-0.015em]">
                  {label(r.userId)}
                </p>
                <p className="mt-0.5 truncate text-[13.5px] text-ink-50">
                  {nameById.get(r.userId)?.email || "no email on file"}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
                <Cell value={fmt(r.turns)} label="turns" />
                <Cell value={compactCount(r.tokensIn)} label="tokens in" />
                <Cell value={compactCount(r.tokensOut)} label="tokens out" />
                <Cell value={microsToUsd(r.micros)} label="cost" />
              </div>
            </Row>
          ))
        )}
      </Panel>

      {/* ------------------------------------------------------- 3. tools */}
      <SectionHead
        title="Tools"
        note="account emails and the transcriber, lifetime counts, not the range above"
      />

      <Panel
        title="Tools per person"
        padded={false}
        action={
          <span className="text-[13px] text-ink-50">
            {toolRows.length} {toolRows.length === 1 ? "account" : "accounts"}
          </span>
        }
      >
        {toolRows.length === 0 ? (
          <Empty
            head="Nobody has used the tools yet."
            body="This counts generated email addresses, the platform accounts signed up with them, the codes those inboxes received, and saved transcripts."
          />
        ) : (
          toolRows.map((r) => (
            <Row key={r.userId}>
              <Link
                href={`/founder/people/${r.userId}`}
                className="min-w-0 flex-1 py-0.5"
              >
                <p className="text-[15px] font-bold tracking-[-0.015em]">
                  {label(r.userId)}
                </p>
                <p className="mt-0.5 truncate text-[13.5px] text-ink-50">
                  {nameById.get(r.userId)?.email || "no email on file"}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
                <Cell value={fmt(r.addresses)} label="addresses" />
                <Cell value={fmt(r.accounts)} label="accounts" />
                <Cell value={fmt(r.codes)} label="codes" />
                <Cell value={fmt(r.transcripts)} label="transcripts" />
              </div>
            </Row>
          ))
        )}
      </Panel>

      {/* --------------------------------------------------- 4. daily cap */}
      <SectionHead
        title="Daily cap"
        note="the runaway rail: the most scrape credits one person can burn in a day"
      />

      <Panel title="The default">
        <p className="text-[13.5px] leading-[1.6] text-ink-70">
          {pricing.defaultDailyCreditCap == null
            ? "No default cap. Anyone without an override below is unlimited."
            : `Everyone without an override below stops at ${fmt(pricing.defaultDailyCreditCap)} credits a day.`}{" "}
          <span className="text-ink-50">
            The number lives in code, in lib/usage-pricing.ts, next to the
            prices.
          </span>
        </p>
      </Panel>

      <CapControls people={pickable} overrides={overrides} />
    </div>
  );
}

/** One of the page's three sections, named. Panels stay panels underneath. */
function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="pt-2">
      <h2 className="text-[17px] font-bold tracking-[-0.02em]">{title}</h2>
      {note && <p className="mt-0.5 text-[13px] text-ink-50">{note}</p>}
    </div>
  );
}

/** A right-aligned number with its name under it. Fixed width so the columns
 *  line up down the table without a real one. */
function Cell({
  value,
  label,
  sub,
  tone,
}: {
  value: string;
  label: string;
  /** A second, quieter number under the name. Where a credit count carries the
   *  dollars it costs, so the money never needs a column of its own. */
  sub?: string;
  tone?: "bad";
}) {
  return (
    <div className="w-[72px] shrink-0 text-right sm:w-[84px]">
      <p
        className={`truncate text-[15px] font-bold tabular-nums ${
          tone === "bad" ? "text-flame-dark" : ""
        }`}
      >
        {value}
      </p>
      <p className="text-[12.5px] text-ink-50">{label}</p>
      {sub && (
        <p className="truncate text-[12px] tabular-nums text-ink-50">{sub}</p>
      )}
    </div>
  );
}

/**
 * One window of spending, cut three ways.
 *
 * The dollars ride under each credit count rather than in a column of their
 * own: the split is the point, and three more money columns would push the
 * whole row past the width of the card.
 */
function SplitRow({
  head,
  note,
  split,
  usd,
}: {
  head: string;
  note: string;
  split: Split;
  usd: (credits: number) => string;
}) {
  const total = splitTotal(split);

  return (
    <Row>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-[15px] font-bold tracking-[-0.015em]">{head}</p>
        <p className="mt-0.5 truncate text-[13.5px] text-ink-50">{note}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
        <Cell value={fmt(split.sync)} label="sync" sub={usd(split.sync)} />
        <Cell value={fmt(split.manual)} label="manual" sub={usd(split.manual)} />
        <Cell value={fmt(split.tool)} label="tool" sub={usd(split.tool)} />
        <Cell value={fmt(total)} label="total" sub={usd(total)} />
      </div>
    </Row>
  );
}

/** Every panel here can be legitimately empty on day one, so none of them are
 *  allowed to render a blank box. */
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
