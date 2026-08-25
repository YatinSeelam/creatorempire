import { baseCentsForVideo, cutPay, groupVideos } from "@/lib/deals";
import { loadDeal } from "@/lib/deals-server";
import { createClient } from "@/lib/supabase/server";

/**
 * A deal's table as a file. Reached from the three dots on the deals list.
 *
 * A route handler rather than a server action, because the point of it is the
 * response headers: an action can return data but it cannot make the browser
 * save a file, and the whole feature is the save. Every write in the product
 * stays in `actions.ts`; this is a read.
 *
 * It sits under `/deals`, which is in the proxy's PROTECTED list, so a signed
 * out request never reaches this code. RLS then scopes `loadDeal` to the caller,
 * which is what makes a guessed deal id a 404 rather than somebody else's
 * earnings. The id in the url is not a permission and is never treated as one.
 *
 * One row per post, not per cut, because a spreadsheet is where you go when you
 * want the raw thing. The money columns still add up to what the deal page
 * shows: `base_usd` and `bonus_usd` are per post and come from the same two
 * functions the on-screen table uses, and `cut_pay_usd` is per cut, because a
 * hand-set payment is set on the cut. That one is written once against the cut's
 * lead post and left blank on the rest, so summing the column gives the deal
 * total instead of counting an override two or three times over.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const detail = await loadDeal(id);
  if (!detail) return new Response("No such deal.", { status: 404 });

  const { deal, brand, accounts, videos, bonusByVideo, replacedVideos } = detail;
  const handleOf = new Map(accounts.map((a) => [a.id, a.handle]));

  const lines: string[] = [
    [
      "posted_on",
      "platform",
      "handle",
      "url",
      "caption",
      "cut",
      "counted",
      "views",
      "likes",
      "comments",
      "shares",
      "base_usd",
      "bonus_usd",
      "cut_pay_usd",
    ].join(","),
  ];

  for (const cut of groupVideos(videos)) {
    const pay = cutPay(deal, cut, bonusByVideo, replacedVideos);

    for (const video of cut.videos) {
      const base = baseCentsForVideo(deal, video, replacedVideos.has(video.id));

      lines.push(
        [
          video.posted_at ? video.posted_at.slice(0, 10) : "",
          video.platform,
          handleOf.get(video.deal_account_id) ?? "",
          video.url ?? "",
          oneLine(video.caption),
          oneLine(cut.title),
          video.counts ? "yes" : "no",
          video.views,
          video.likes,
          video.comments,
          video.shares,
          base === null ? "" : usd(base),
          usd(bonusByVideo.get(video.id) ?? 0),
          // the lead carries the cut's pay. `cut.key` is the first post of the
          // group, which is not always `cut.videos[0]`: that array is sorted
          // into platform order for display.
          video.id === cut.key ? usd(pay.payCents) : "",
        ]
          .map(cell)
          .join(",")
      );
    }
  }

  const name = `${slug(brand.name)}-${slug(deal.name)}-posts`;

  return new Response(BOM + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      // an export is a snapshot of numbers that move every night, so a cached
      // copy of it is a wrong copy of it.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * What makes Excel read the file as utf-8 rather than latin-1, which is the
 * difference between a caption's emoji and four bytes of mojibake. Written as an
 * code point rather than the character itself: as a literal it is invisible in
 * the source and the first person to tidy the file deletes it without knowing.
 */
const BOM = String.fromCharCode(0xfeff);

/** Cents to a plain decimal. No currency symbol: this column gets summed. */
const usd = (cents: number) => (cents / 100).toFixed(2);

/** Captions arrive with newlines in them, and a newline is a row break here. */
const oneLine = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

/**
 * One cell, quoted if it has to be and defused if it could be a formula.
 *
 * Captions and handles are scraped off tiktok and instagram, which means a
 * stranger picks their contents. A caption starting `=` or `@` is a live formula
 * the moment this file is opened in Excel or Sheets, and the interesting ones
 * reach the network. A leading apostrophe is what those two read as "this is
 * text", and it is not shown in the cell.
 *
 * The numeric escape hatch matters: `-12.00` starts with a dangerous character
 * and is also a number this file exists to add up, so anything that is only
 * digits is left exactly as it is.
 */
const cell = (value: string | number) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "deal";
