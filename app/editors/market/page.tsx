import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { toJob } from "@/components/editors/coerce";
import { MarketBoard } from "@/components/editors/market-board";
import { EDITING_ENABLED } from "@/lib/editing";
import { createClient } from "@/lib/supabase/server";

/**
 * How many claims an editor may hold at once, mirrored from `claim_edit_job`.
 *
 * A copy of a number the database owns, which is a thing worth doing exactly
 * once and never for a decision: the rpc still refuses over the cap and this
 * only ever draws the pill. If the two drift, the pill is wrong and nobody is
 * overpaid or wrongly blocked.
 */
function claimCap(tier: number | null): number {
  return tier === 1 ? 2 : tier === 2 ? 5 : 10;
}

/**
 * The bounty board. Every open job, newest first, first claim wins. The claim
 * itself is race-safe server-side, so two people can stare at the same card
 * and only one of them ends up in the workspace.
 */
export default async function MarketPage() {
  // the group's layout opened up for the hiring pages, so the market carries
  // its own flag now. before the session read: a hidden feature 404s rather
  // than bouncing a stranger to a login form. the founder keeps a way in
  // while the flag is off, to rehearse the launch end to end.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!EDITING_ENABLED) {
    const { data: isFounder } = await supabase.rpc("am_i_admin");
    if (!isFounder) notFound();
  }
  if (!user) redirect("/login?next=/editors/market");

  const [{ data: editorRow }, { data: jobRows }, { count: openClaims }] =
    await Promise.all([
      supabase
        .from("editors")
        .select("status, tier")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("edit_jobs")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false }),
      // head + count: the slots pill needs the number and none of the rows.
      // same predicate the rpc counts on, or the pill would say a slot is free
      // on a board where claiming refuses.
      supabase
        .from("edit_jobs")
        .select("id", { count: "exact", head: true })
        .eq("editor_id", user.id)
        .in("status", ["claimed", "revisions"]),
    ]);

  const jobs = (jobRows ?? []).map((r) => toJob(r as Record<string, unknown>));
  const cap = claimCap((editorRow?.tier as number | null) ?? null);
  const held = openClaims ?? 0;

  return (
    // page-fill is what globals.css hangs `main:has()` off: the shell becomes
    // exactly one viewport tall and the board takes what is left, so the window
    // never scrolls and the grid moves inside its own frame instead. under lg
    // the class does nothing and the page scrolls the ordinary way.
    <div className="page-fill space-y-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-[clamp(1.5rem,3.4vw,1.95rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            job board
          </h1>
          <p className="mt-2 text-[14.5px] text-ink-50">
            open jobs. first claim wins. deliver within 36 hours, 18 on a rush.
          </p>
        </div>
        {/* what you are allowed to be holding, not what is on the board. it is
            the one number that decides whether pressing claim will work, and an
            editor at their cap otherwise finds that out from an error. */}
        {editorRow && (
          <span
            className={`shrink-0 rounded-pill border px-4 py-2 text-[13.5px] font-bold tabular-nums shadow-card ${
              held >= cap
                ? "border-flame bg-ember text-flame-dark"
                : "border-line bg-paper text-ink-70"
            }`}
          >
            {held}/{cap} slots
          </span>
        )}
      </div>

      {!editorRow && (
        <p className="rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
          you need an editor profile before you can claim.{" "}
          <Link href="/editors" className="font-semibold underline">
            set one up
          </Link>{" "}
          first.
        </p>
      )}

      {editorRow?.status === "paused" && (
        <p className="rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
          your profile is paused, so claiming is off. flip it back to active on{" "}
          <Link href="/editors/settings" className="font-semibold underline">
            your profile
          </Link>{" "}
          when you are ready for work.
        </p>
      )}

      <MarketBoard jobs={jobs} />
    </div>
  );
}
