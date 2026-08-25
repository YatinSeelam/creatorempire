import { redirect } from "next/navigation";

/**
 * One brand's composer moved to /deals/[id]/posting, where it is a tab on the
 * deal rather than a page behind a second rail row that listed the same brands.
 *
 * Kept as a redirect rather than deleted. Upload-Post sends a creator back to
 * whatever return url the connect link was built with, and a link built before
 * this shipped is still out there in a browser tab waiting to be finished.
 */
export default async function DealSocialRedirect({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  redirect(`/tools/autoposting?deal=${encodeURIComponent(dealId)}`);
}
