import { SocialPlanner, type PlannerDeal } from "@/components/dash/social-planner";
import { DashBar, Page, Pill, barTitle } from "@/components/dash/ui";
import { reconcilePosts, type SocialPost } from "@/lib/autopost/server";
import { brandLogo } from "@/lib/brand-catalog";
import { createClient } from "@/lib/supabase/server";
import { dealScope, loadWorkspace, onBooks } from "@/lib/workspace";

export const metadata = { title: "Posting planner · Creator Empire" };

// same reason as the deal's posting tab: the planner edits and cancels through
// the same actions, and those talk to Upload-Post. See that file's note.
export const maxDuration = 300;

/**
 * The planning calendar: every deal's schedule on one page.
 *
 * /social spent a while as a redirect to /deals after the per-deal composer
 * moved onto the deal itself. The url comes back as the one view the per-deal
 * tabs cannot give: a creator posting for four brands plans a WEEK, not a
 * brand, and "is tuesday too crowded" is a question you can only answer with
 * all four schedules on one grid. Composing still happens on the deal — a
 * pressed slot lands on that deal's Posting tab with the time filled in — so
 * nothing here duplicates the composer, and the old bookmarks land on
 * something better than a bounce.
 *
 * Reads are scoped exactly like every other list: deals through
 * `dealScope()`/`onBooks()`, posts through rls plus a filter to those deals.
 */

const POST_COLS =
  "id, user_id, deal_id, caption, platforms, video_url, scheduled_for, status, job_id, request_id, results, error, created_at, notified_at";

export default async function SocialPlannerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [scope, ws] = await Promise.all([dealScope(), loadWorkspace()]);

  const [{ data: dealRows }, { data: postRows }] = await Promise.all([
    supabase
      .from("deals")
      .select("id, name, status, brand:brands(name, logo_key, logo_url)")
      .filter(...onBooks(scope))
      .order("created_at", { ascending: false }),
    user
      ? supabase
          .from("social_posts")
          .select(POST_COLS)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: null }),
  ]);

  const deals: PlannerDeal[] = ((dealRows ?? []) as unknown as {
    id: string;
    name: string;
    status: string;
    brand: { name: string; logo_key: string | null; logo_url: string | null } | null;
  }[])
    // live deals first in the "which brand" picker; the rest still compose.
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active"))
    .map((d) => ({
      id: d.id,
      name: d.name,
      brand: d.brand?.name ?? "unknown",
      logo: d.brand ? brandLogo(d.brand) : "",
    }));

  // the user's rows, cut to the books being looked at. a post with no deal
  // (the pre-per-deal era) belongs to the personal account, so it only shows
  // there.
  const onTheseBooks = new Set(deals.map((d) => d.id));
  let posts = ((postRows ?? []) as SocialPost[]).filter((p) =>
    p.deal_id ? onTheseBooks.has(p.deal_id) : scope.orgId === null
  );

  // same pass the per-deal tab runs: ask upstream about anything still in
  // flight so a slot that already fired does not sit on the grid as movable.
  // it skips terminal rows, so this is a call per pending post, not per post.
  if (process.env.UPLOAD_POST_API_KEY) {
    posts = await reconcilePosts(supabase, posts).catch(() => posts);
  }

  return (
    <>
      <DashBar
        lead={
          <div className="flex min-w-0 items-center gap-3">
            <h1 className={barTitle}>Posting planner</h1>
            {ws.seatBrand && <Pill tone="quiet">for {ws.seatBrand.name}</Pill>}
          </div>
        }
      />

      {/* fills the viewport like the posting tab does: the grid scrolls inside
          its own frame instead of growing the page past it. */}
      <Page fill>
        <SocialPlanner posts={posts} deals={deals} />
      </Page>
    </>
  );
}
