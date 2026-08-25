import { redirect } from "next/navigation";

/**
 * The per-deal composer is gone. There was one place to schedule a post
 * (/tools/autoposting) and a second, smaller one on the deal, which drew the
 * same accounts and the same queue in a different layout; two composers for
 * one job is a thing to keep in sync for no one. Autoposting is the one now.
 *
 * Kept as a redirect rather than deleted: Upload-Post sends a creator back to
 * the return url the connect link was built with, and every older link in the
 * product (queue rows, the planner, the deals list) pointed here.
 */
export default async function DealPostingRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/tools/autoposting?deal=${encodeURIComponent(id)}`);
}
