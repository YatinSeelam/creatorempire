import type { Metadata } from "next";
import { PortfolioPreview } from "@/components/dash/portfolio-preview";
import { loadPortfolio, loadPortfolioAgency } from "@/lib/portfolio";

export const metadata: Metadata = {
  title: "Preview · Creator Empire",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * The saved portfolio at full size, draft or not.
 *
 * It sits under (dash) so the layout's requireViewer covers it, which is the
 * whole point: the public /<slug> route refuses anything
 * unpublished, and the one moment a creator most wants to see the real page is
 * right before they publish it.
 */
export default async function PortfolioPreviewPage() {
  const [portfolio, agency] = await Promise.all([
    loadPortfolio(),
    loadPortfolioAgency(),
  ]);

  return <PortfolioPreview portfolio={portfolio} agency={agency} />;
}
