import type { Metadata } from "next";
import Link from "next/link";
import { toApplication, toJob } from "@/components/editors/coerce";
import { BrandMark } from "@/components/dash/brand-mark";
import { EmptyJobsArt } from "@/components/editors/empty-art";
import { EditorsLanding } from "@/components/editors/landing";
import { OnboardingWizard } from "@/components/editors/onboarding-wizard";
import {
  Arrow,
  EmptyState,
  Panel,
  PrimaryLink,
  QuietLink,
  Row,
  Stat,
  StatusPill,
} from "@/components/editors/ui";
import {
  APPLICATION_NOTE,
  EDITING_ENABLED,
  bundleLabel,
  type EditJob,
} from "@/lib/editing";
import { brandLogo } from "@/lib/brand-catalog";
import { landing } from "@/lib/hiring";
import { money, shortDate } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: `${landing.headline.pre} ${landing.headline.accent} · creator empire`,
  description: landing.sub,
  // the one page in this group a stranger is meant to find. everything else
  // under /editors is somebody's own desk and stays out of the index.
  robots: { index: true, follow: true },
};

function JobRow({ job }: { job: EditJob }) {
  return (
    <Row>
      <div className="flex min-w-0 items-center gap-3">
        {/* the brand is stamped on the job, so an editor can see who the work
            is for without any access to the creator's deals */}
        <BrandMark
          name={job.brand_name ?? job.title}
          logo={brandLogo({
            logo_key: job.brand_logo_key,
            logo_url: job.brand_logo_url,
          })}
          size="sm"
        />
        <div className="min-w-0">
          {job.brand_name && (
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-50">
              {job.brand_name}
            </p>
          )}
          <Link
            href={`/editors/jobs/${job.id}`}
            className="block truncate font-semibold tracking-[-0.01em] transition-colors hover:text-flame"
          >
            {job.title}
          </Link>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-[13px] text-ink-50">
        <span className="tabular-nums">{bundleLabel(job)}</span>
        {job.sla_at && job.status === "claimed" && (
          <span>due {shortDate(job.sla_at)}</span>
        )}
        <StatusPill status={job.status} />
      </div>
    </Row>
  );
}

/**
 * The editor's front door, three pages in one url.
 *
 * Signed out: the three-step landing. Signed in with no account yet: the
 * onboarding wizard, and finishing it is what creates the editor account.
 * Signed in with one: the desk, which right now is honest about the state of
 * the world, jobs are coming, here is how it works, here is your info.
 */
export default async function EditorsHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <EditorsLanding />;
  }

  const [{ data: applicationRow }, { data: isFounder }] = await Promise.all([
    supabase
      .from("editor_applications")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.rpc("am_i_admin"),
  ]);

  // the market is hidden from editors until the creator side is real, but the
  // founder sees the whole desk regardless: rehearsing the loop end to end is
  // the only way to know it works before anybody is paid for it.
  const marketOpen = EDITING_ENABLED || isFounder === true;

  // signed in, no editor account yet: the wizard is the whole page. its
  // submit creates both the application row and the editors row underneath.
  if (!applicationRow) {
    return (
      <div className="py-4">
        <div className="mb-6 text-center">
          <h1 className="text-[clamp(1.5rem,3.4vw,1.95rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            set up your editor account
          </h1>
          <p className="mt-2 text-[14px] text-ink-50">
            four quick screens. no calls, no interviews.
          </p>
        </div>
        {/* the id is for the photo upload: the portfolio bucket only accepts a
            write whose first path segment is the uploader's own uid. */}
        <OnboardingWizard userId={user.id} defaultEmail={user.email ?? ""} />
      </div>
    );
  }

  const application = toApplication(applicationRow as Record<string, unknown>);

  return (
    // page-fill is what globals.css hangs `main:has()` off, so the shell becomes
    // exactly one viewport tall and this takes what is left. the desk is meant
    // to be read at a glance, and a window scrollbar means half the answer is
    // below a fold nobody agreed on. under lg the class does nothing: a single
    // column of three stats and a panel does not fit at any height.
    <div className="page-fill space-y-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(1.5rem,3.4vw,1.95rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            {application.name || "your desk"}
          </h1>
          <p className="mt-2 text-[14.5px] text-ink-50">
            {APPLICATION_NOTE[application.status]}
          </p>
        </div>
        {marketOpen && (
          <PrimaryLink href="/editors/market" className="shrink-0">
            open job board
            <Arrow />
          </PrimaryLink>
        )}
      </div>

      {marketOpen ? (
        <MarketBlocks userId={user.id} />
      ) : (
        <Panel
          title="your jobs"
          padded={false}
          scroll
          className="lg:min-h-0 lg:flex-1"
        >
          {/* the terms used to be a second line under this panel. they belong
              in the empty state itself: somebody reading "no jobs yet" is
              asking what the jobs pay when they do land. */}
          <EmptyState art={<EmptyJobsArt />} title="no jobs yet">
            we are onboarding creators right now. jobs land here the moment they
            start posting, and we will ping you. $1 talking head, $2 full edit,
            24h to deliver, cash out any time.
          </EmptyState>
        </Panel>
      )}
    </div>
  );
}

/** What the market owes and holds, shown once jobs are live. */
async function MarketBlocks({ userId }: { userId: string }) {
  const supabase = await createClient();

  // only what the three numbers and the job list need. the payout method, the
  // stripe account state and the full history are /editors/payouts' business
  // now, and fetching them here was four round trips to render nothing.
  const [{ data: jobRows }, { data: payoutRows }] = await Promise.all([
    supabase
      .from("edit_jobs")
      .select("*")
      .eq("editor_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("editor_payouts")
      .select("amount_cents, status, batch_id")
      .eq("editor_id", userId),
  ]);

  const jobs = (jobRows ?? []).map((r) => toJob(r as Record<string, unknown>));
  const active = jobs.filter((j) => j.status === "claimed" || j.status === "revisions");
  active.sort(
    (a, b) => Number(b.status === "revisions") - Number(a.status === "revisions")
  );
  const delivered = jobs.filter((j) => j.status === "delivered");

  const payouts = (payoutRows ?? []) as {
    amount_cents: number;
    status: string;
    batch_id: string | null;
  }[];
  // what you could take right now, which is not the same as what you are owed:
  // a due row carrying a batch stamp is already inside a batch a rail is
  // sending. counting those here would have the desk offering money the
  // payouts page has correctly stopped offering.
  const dueCents = payouts
    .filter((p) => p.status === "due" && !p.batch_id)
    .reduce((n, p) => n + p.amount_cents, 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {/* credits and the dollar figure are the same money counted twice, on
            purpose: the board prices jobs in credits and the bank moves
            dollars, and an editor deciding whether to cash out is asking the
            second question. 1 credit = $1. */}
        <Stat
          size="lg"
          label="credits"
          value={String(Math.floor(dueCents / 100))}
          note="credits available"
        />
        <Stat
          size="lg"
          label="in edit"
          value={String(active.length)}
          note={
            delivered.length
              ? `${delivered.length} out for approval`
              : "jobs in edit"
          }
        />
        <Stat
          size="lg"
          label="available to cash out"
          value={money(dueCents)}
          note="ready to cash out"
        />
      </div>

      <Panel
        title="your jobs"
        padded={false}
        scroll
        className="lg:min-h-0 lg:flex-1"
        action={
          <QuietLink href="/editors/market">
            view job board
            <Arrow className="size-[15px]" />
          </QuietLink>
        }
      >
        {active.length === 0 && delivered.length === 0 ? (
          <EmptyState
            art={<EmptyJobsArt />}
            title="no jobs yet"
            action={
              <PrimaryLink href="/editors/market">open job board</PrimaryLink>
            }
          >
            nothing here yet. jobs are posted on the board as creators come on.
          </EmptyState>
        ) : (
          [...active, ...delivered].map((j) => <JobRow key={j.id} job={j} />)
        )}
      </Panel>
    </>
  );
}
