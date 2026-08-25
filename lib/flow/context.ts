/**
 * The context pack: what flow knows before it asks anything.
 *
 * Not a table dump. A compact digest of the creator's real brands, deals and
 * accounts **with their ids**, because the single thing that stops an ai from
 * inventing entities is having the real ones in front of it. Without this a
 * model asked to "add the gymshark bonus" writes the string "gymshark" into a
 * deal_id column; with it, it writes the uuid.
 *
 * Hard capped on purpose. It rides on every turn, so it has to be small enough
 * that sending it is never a decision.
 */

import { describeRule } from "@/lib/deals";
import { loadDeals } from "@/lib/deals-server";
import { money, shortDate, today } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

/** How many deals get their bonus rules spelled out. The rest are one line. */
const DEALS_WITH_RULES = 12;

export async function buildContextPack(pageRef: string | null): Promise<string> {
  const supabase = await createClient();

  const [deals, rules] = await Promise.all([
    loadDeals(),
    supabase.from("bonus_rules").select("*").order("created_at", { ascending: true }),
  ]);

  const rulesByDeal = new Map<string, string[]>();
  for (const rule of rules.data ?? []) {
    const list = rulesByDeal.get(rule.deal_id) ?? [];
    // one flat sentence per rule, which is the shape a prompt wants. The screen
    // splits the same facts into a headline plus chips (`lib/bonus.ts`) because
    // a person scans them and a model reads them.
    list.push(describeRule(rule));
    rulesByDeal.set(rule.deal_id, list);
  }

  const lines: string[] = [];

  lines.push(`Today is ${today()} (UTC). Day keys are YYYY-MM-DD.`);
  lines.push(
    pageRef
      ? `The creator is on ${pageRef} right now, so an unqualified "this deal" or "the bonus" most likely means whatever that page is showing.`
      : `The creator did not open this from a specific page.`
  );

  if (deals.length === 0) {
    lines.push("");
    lines.push("They have no deals yet. Anything they describe is a new one.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(`DEALS (${deals.length}). Use these ids, never a name.`);

  deals.slice(0, DEALS_WITH_RULES).forEach((row) => {
    const { deal, brand } = row;
    const window = [
      deal.started_on ? `from ${shortDate(deal.started_on)}` : null,
      deal.ends_on ? `to ${shortDate(deal.ends_on)}` : "open ended",
    ]
      .filter(Boolean)
      .join(" ");

    lines.push("");
    lines.push(`- ${brand.name} — ${deal.name} [${deal.status}]`);
    lines.push(`  deal_id: ${deal.id}   brand_id: ${brand.id}`);
    lines.push(
      `  ${money(deal.flat_fee_cents)} ${deal.flat_fee_kind}, ${deal.pay_cycle}, net ${deal.net_days}, ${window}`
    );
    lines.push(
      `  earned ${money(row.earnedCents)}, paid ${money(row.paidCents)}, owed ${money(row.earnedCents - row.paidCents)}`
    );
    if (row.platforms.length) lines.push(`  posts on: ${row.platforms.join(", ")}`);

    const written = rulesByDeal.get(deal.id) ?? [];
    if (written.length) {
      lines.push(`  bonuses: ${written.join(" | ")}`);
    } else {
      lines.push("  bonuses: none");
    }
  });

  if (deals.length > DEALS_WITH_RULES) {
    lines.push("");
    lines.push(
      `Plus ${deals.length - DEALS_WITH_RULES} older deals not listed here. Call list_deals to see them.`
    );
  }

  return lines.join("\n");
}
