import type { Metadata } from "next";
import { PortfolioEditor } from "@/components/dash/portfolio-editor";
import { requireViewer } from "@/lib/access";
import { loadPortfolio, loadPortfolioAgency } from "@/lib/portfolio";

export const metadata: Metadata = {
  title: "Portfolio · Creator Empire",
  robots: { index: false },
};

// access state is per-request and must never come out of a cache.
export const dynamic = "force-dynamic";

/**
 * The portfolio maker. The whole page is the editor — it owns the bar too,
 * because the public address in the top right has to track the link field as it
 * is typed, and a server-rendered bar could only ever show the saved slug.
 *
 * Three things are read here and nowhere else. The document, because it is one
 * row and the editor holds it as one piece of state from the first paint rather
 * than flashing an empty form. The user id, because every upload path is keyed
 * on it: a browser that decides its own storage prefix is a browser that can be
 * told to write into someone else's folder. And the programme's sign-off, so
 * the preview shows the same footer the visitor gets.
 */
export default async function PortfolioPage() {
  // the (dash) layout already ran this gate; calling it again is how the page
  // gets the user row, since a layout cannot hand anything to its children.
  // the whole check is memoised per request, so it is not a second round trip.
  const [{ user }, portfolio, agency] = await Promise.all([
    requireViewer("/portfolio"),
    loadPortfolio(),
    loadPortfolioAgency(),
  ]);

  return <PortfolioEditor initial={portfolio} userId={user.id} agency={agency} />;
}
