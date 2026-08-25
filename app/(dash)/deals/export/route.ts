import { csvResponse, oneLine, row, usd } from "@/lib/csv";
import { loadDeals } from "@/lib/deals-server";
import { createClient } from "@/lib/supabase/server";

/**
 * Every deal as one file, one row per deal, with the same four numbers the
 * list page shows. The per-post detail stays on the per-deal export at
 * `/deals/[id]/export`; this is the portfolio view of the same data.
 *
 * A route handler because the point is the response headers (see the per-deal
 * export). RLS scopes `loadDeals`, so the file only ever holds the caller's
 * own deals.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const rows = await loadDeals();

  const lines: string[] = [
    row([
      "brand",
      "deal",
      "status",
      "started_on",
      "ends_on",
      "platforms",
      "videos",
      "views",
      "flat_usd",
      "bonus_usd",
      "earned_usd",
      "paid_usd",
      "owed_usd",
      "last_posted",
    ]),
  ];

  for (const r of rows) {
    lines.push(
      row([
        oneLine(r.brand.name),
        oneLine(r.deal.name),
        r.deal.status,
        r.deal.started_on ?? "",
        r.deal.ends_on ?? "",
        r.platforms.join(" "),
        r.videoCount,
        r.totalViews,
        usd(r.flatCents),
        usd(r.bonusCents),
        usd(r.earnedCents),
        usd(r.paidCents),
        usd(r.earnedCents - r.paidCents),
        r.lastPostedAt ? String(r.lastPostedAt).slice(0, 10) : "",
      ])
    );
  }

  return csvResponse("deals", lines);
}
