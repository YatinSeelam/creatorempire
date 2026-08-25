/**
 * Flow's tool surface. Two halves, and the split is the whole safety model.
 *
 * READ tools run right here, as the signed-in user, against rls. They answer
 * questions and they never write. `get_earnings` in particular *reads* the
 * engine's output rather than computing anything: an llm doing arithmetic on
 * views is a bug with a plausible sounding explanation attached, so the number
 * flow reports is the number postgres already produced.
 *
 * WRITE tools do not write. Every one of them returns a proposal, and a
 * proposal only becomes a row when a person presses accept in
 * `app/(dash)/flow/actions.ts`, which calls the same server action the form
 * calls. There is no third path.
 *
 * Every schema here is built from the field registry in `lib/deal-schema.ts`
 * via `./registry`, so a field's description, its enum values and its cap all
 * come from the same definition the form renders.
 */

import { PLATFORMS, describeRule, profileUrl, type Platform } from "@/lib/deals";
import { loadDeal, loadDeals } from "@/lib/deals-server";
import { money, views as fmtViews, shortDate } from "@/lib/money";
import { accountProperties, brandProperties, dealProperties, ruleProperties } from "./registry";

/** The anthropic tool shape. `input_schema` must be an object schema. */
export type ToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
};

const object = (
  properties: Record<string, unknown>,
  required: string[] = []
): ToolDef["input_schema"] => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

/**
 * One bonus rule, as json. Written once and read twice: `propose_bonus_rule`
 * adds a rule to a deal that exists, and `propose_deal.rules[]` carries the
 * rules a brand described in the same breath as the deal itself.
 *
 * That second reader is the whole reason this is a function. Before it existed
 * a brand dump had nowhere to put "and $3 CPM on tiktok": propose_bonus_rule
 * needs a deal id, a deal being created has none, so the terms went into the
 * deal's `notes` and the bonus silently earned nothing. A rule that is prose is
 * a rule the earnings engine cannot see.
 */
const ruleShape = () => ({
  label: { type: "string", maxLength: 80, description: "A short name for the rule." },
  ...ruleProperties(),
  rate: {
    type: "string",
    description:
      "For a cpm rule: dollars per 1,000 views. A $3 CPM is '3'. Required when kind is cpm.",
  },
  amount: {
    type: "string",
    description:
      "For a per_video rule: dollars paid once per video posted in the window. Required when kind is per_video.",
  },
  tiers: {
    type: "array",
    description:
      "For a milestone rule: the tier table. Required when kind is milestone. Tiers never stack, only the highest reached pays.",
    items: object(
      {
        views: { type: "integer", minimum: 0, description: "The view count that unlocks it." },
        amount: { type: "string", description: "What it pays, in dollars." },
      },
      ["views", "amount"]
    ),
  },
  platforms: {
    type: "array",
    description:
      "Which platforms this rule pays on. Leave it out to mean every platform, which is the usual case.",
    items: { type: "string", enum: [...PLATFORMS] },
  },
  min_views: {
    type: "integer",
    minimum: 0,
    description: "A video under this many views earns nothing from this rule.",
  },
  cap: { type: "string", description: "The most this rule can pay per video, in dollars." },
  window_kind: {
    type: "string",
    enum: ["forever", "since_post", "absolute"],
    description:
      "Which views count. 'forever' counts every view ever. 'since_post' counts only the first N days of each video's life. 'absolute' counts only views that accrued between two fixed dates.",
  },
  window_days: {
    type: "integer",
    minimum: 1,
    description: "Required when window_kind is since_post.",
  },
  starts_on: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Required when window_kind is absolute.",
  },
  ends_on: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "The last day of an absolute window. Leave out for open ended.",
  },
});

/* ------------------------------------------------------------------- reads */

const READ_TOOLS: ToolDef[] = [
  {
    name: "list_deals",
    description:
      "Every deal the creator has, with its brand, status, terms in one line, views, what it has earned and what has been paid. Call this before answering anything about more than one brand, and to find a deal's id.",
    input_schema: object({
      status: {
        type: "string",
        enum: ["active", "draft", "paused", "ended"],
        description: "Only deals in this state. Omit for all of them.",
      },
    }),
  },
  {
    name: "get_deal",
    description:
      "One deal in full: terms, bonus rules in plain english, the accounts it posts from, a per-platform breakdown of views and videos, its recent videos, and its payouts. This is where \"how did instagram do vs tiktok\" is answered. Use it before proposing any change to an existing deal.",
    input_schema: object(
      { deal_id: { type: "string", description: "The deal's id, from list_deals." } },
      ["deal_id"]
    ),
  },
  {
    name: "get_earnings",
    description:
      "What the creator is owed right now: earned minus paid, per deal and in total. These numbers come out of the database's own earnings functions. Report them as given and never recompute them from views.",
    input_schema: object({
      deal_id: { type: "string", description: "One deal only. Omit for every deal." },
    }),
  },
];

/* ------------------------------------------------------------------ writes */

const WRITE_TOOLS: ToolDef[] = [
  {
    name: "propose_deal",
    description:
      "Propose a new deal, its brand, its bonus rules, and the accounts it posts from, as one card the creator approves. Use this for a brand dump: a message, a pasted email, or a screenshot describing work with a brand. Every bonus the brand described goes in `rules` on THIS call, never in `notes` and never as a separate propose_bonus_rule — that tool needs a deal id, and a deal being created does not have one yet. Do not use this to change a deal that already exists.",
    input_schema: object(
      {
        ...brandProperties(),
        brand_id: {
          type: "string",
          description:
            "The id of an existing brand from the context pack, when this deal is with a brand already on file. Leave it out to create a new brand from the name.",
        },
        ...dealProperties(),
        rules: {
          type: "array",
          description:
            "How this deal pays on performance. One entry per distinct way the brand pays, so a $3 tiktok CPM and a $5 youtube CPM are two entries. Leave it out only when the brand described no bonus at all. Bonus terms belong here, never in notes.",
          items: object(ruleShape(), ["kind"]),
        },
        accounts: {
          type: "array",
          description: "The accounts this deal posts from. At most one per platform.",
          items: object(accountProperties(), ["platform", "handle"]),
        },
        evidence: {
          type: "string",
          description:
            "The literal words from the creator's message or the screenshot that this deal came from. Quoted, not paraphrased.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "How sure you are the terms are right, 0 to 1.",
        },
      },
      // brand_name is required even when brand_id is given. the draft carries
      // both and resolveBrand prefers the id, so sending the name costs nothing
      // and removes the one way this proposal can fail at apply time.
      ["brand_name", "name", "evidence", "confidence"]
    ),
  },
  {
    name: "propose_deal_edit",
    description:
      "Propose a change to a deal that already exists: its status, its dates, its terms, its notes. Send ONLY the fields that change — everything you leave out keeps the value it has today. Ending a deal is a status change to 'ended', and that is the closest thing to removing one: there is no delete, and a deal that is over is ended, never wiped. Call get_deal first when you are changing money, so the card shows a change from something real.",
    input_schema: object(
      {
        deal_id: { type: "string", description: "The deal to change, by id." },
        ...dealProperties(),
        clear: {
          type: "array",
          description:
            "Fields to empty out, for when the answer is 'there is no end date any more'. Only for fields that are allowed to be blank.",
          items: {
            type: "string",
            enum: ["started_on", "ends_on", "cycle_anchor_on", "contract_url", "notes"],
          },
        },
        evidence: {
          type: "string",
          description: "The creator's own words this change came from. Quoted, not paraphrased.",
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      ["deal_id", "evidence", "confidence"]
    ),
  },
  {
    name: "propose_deal_delete",
    description:
      "Propose permanently deleting a deal. This wipes the deal and takes its accounts, bonus rules, videos and earnings history with it, so only use it when the creator plainly asks to delete or remove a deal. When they just want a deal over, propose_deal_edit with status 'ended' keeps the record instead. The card is money tier and a human must accept it; nothing is deleted until they do.",
    input_schema: object(
      {
        deal_id: { type: "string", description: "The deal to delete, by id, from list_deals or the context pack." },
        evidence: {
          type: "string",
          description: "The creator's own words asking for the deletion. Quoted, not paraphrased.",
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      ["deal_id", "evidence", "confidence"]
    ),
  },
  {
    name: "propose_bonus_rule",
    description:
      "Propose one way a deal pays on performance: a CPM, a flat amount per video, or a table of view tiers. A deal can hold several, so propose one rule per distinct way the brand pays. Money fields are written in dollars, the way the rate sheet writes them.",
    input_schema: object(
      {
        deal_id: { type: "string", description: "The deal this bonus belongs to." },
        ...ruleShape(),
        evidence: { type: "string", description: "The literal words this rule came from." },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      ["deal_id", "kind", "evidence", "confidence"]
    ),
  },
  {
    name: "propose_brand_edit",
    description:
      "Propose a change to a brand: its name, its website, who you talk to there. Renaming a brand renames it on every deal that points at it, which is usually what somebody means by 'that brand is spelled wrong'. When they mean the name of one run of work instead, that is the deal's own name and it goes through propose_deal_edit. Send ONLY the fields that change.",
    input_schema: object(
      {
        brand_id: {
          type: "string",
          description: "The brand to change, by id, from list_deals or the context pack.",
        },
        ...brandProperties(),
        evidence: {
          type: "string",
          description: "The creator's own words this change came from. Quoted, not paraphrased.",
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      ["brand_id", "evidence", "confidence"]
    ),
  },
  {
    name: "propose_deal_account",
    description:
      "Propose adding an account a deal posts from. A deal holds at most one account per platform, so this replaces nothing: if the deal already has a tiktok, say so instead of proposing a second.",
    input_schema: object(
      {
        deal_id: { type: "string" },
        ...accountProperties(),
        evidence: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      ["deal_id", "platform", "handle", "evidence", "confidence"]
    ),
  },
  {
    name: "ask",
    description:
      "Ask one question when a reference is ambiguous or a money term is missing. Two candidate brands is a question, never a guess. One question at a time, with the options as buttons. Asking costs nothing and prevents everything.",
    input_schema: object(
      {
        question: { type: "string", description: "One sentence." },
        options: {
          type: "array",
          maxItems: 4,
          items: { type: "string" },
          description: "The answers, as short button labels. Leave out for an open question.",
        },
      },
      ["question"]
    ),
  },
];

export const FLOW_TOOLS: ToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS];

export const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));
export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

/* --------------------------------------------------------------- executing */

type Input = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Run a read tool and hand back something compact enough to sit in context.
 *
 * Everything is pre-formatted: money as "$1,250", views as "1.28m", days as
 * "Aug 8". The model is reporting these to a person, not doing maths on them,
 * and a formatted string is the one shape it cannot get wrong on the way out.
 */
export async function runReadTool(name: string, input: Input): Promise<unknown> {
  switch (name) {
    case "list_deals": {
      const wanted = str(input.status);
      const rows = await loadDeals();
      return rows
        .filter((r) => !wanted || r.deal.status === wanted)
        .map((r) => ({
          deal_id: r.deal.id,
          brand: r.brand.name,
          brand_id: r.brand.id,
          name: r.deal.name,
          status: r.deal.status,
          started_on: r.deal.started_on,
          ends_on: r.deal.ends_on,
          platforms: r.platforms,
          videos: r.videoCount,
          views: fmtViews(r.totalViews),
          earned: money(r.earnedCents),
          paid: money(r.paidCents),
          owed: money(r.earnedCents - r.paidCents),
          last_posted: r.lastPostedAt ? shortDate(r.lastPostedAt) : null,
        }));
    }

    case "get_deal": {
      const id = str(input.deal_id);
      if (!id) return { error: "get_deal needs a deal_id." };

      const d = await loadDeal(id);
      if (!d) return { error: "No deal with that id. Call list_deals first." };

      return {
        deal_id: d.deal.id,
        brand: { id: d.brand.id, name: d.brand.name },
        name: d.deal.name,
        status: d.deal.status,
        started_on: d.deal.started_on,
        ends_on: d.deal.ends_on,
        flat_fee: money(d.deal.flat_fee_cents),
        flat_fee_kind: d.deal.flat_fee_kind,
        min_views_for_base: d.deal.min_views_for_base,
        pay_cycle: d.deal.pay_cycle,
        net_days: d.deal.net_days,
        notes: d.deal.notes,
        accounts: d.accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          handle: a.handle,
          active: a.active,
          // built here, never by the model. tiktok wants the @ and instagram
          // does not, and a handle guessed into a url is a dead link in an
          // answer somebody is about to send to a brand.
          url: profileUrl(a.platform, a.handle),
        })),
        rules: d.rules.map((r) => ({
          id: r.id,
          label: r.label,
          reads_as: describeRule(r),
          earned: money(d.bonusByRule.get(r.id) ?? 0),
        })),
        // the answer to "how many views per platform", computed here rather
        // than left to the model. it used to say it was not allowed to add the
        // numbers up, which was true and useless: the rule is that flow does
        // not do arithmetic, not that nobody does. javascript adds, flow reports.
        by_platform: PLATFORMS.map((platform) => {
          const shot = d.videos.filter((v) => v.platform === platform);
          // an excluded video is excluded from the money, so it is excluded
          // here too. a per-platform total that disagrees with the deal total
          // is worse than no total.
          const counted = shot.filter((v) => v.counts);
          const account = d.accounts.find((a) => a.platform === platform);
          return {
            platform,
            handle: account?.handle ?? null,
            url: account ? profileUrl(account.platform, account.handle) : null,
            videos: shot.length,
            counted_videos: counted.length,
            views: fmtViews(counted.reduce((sum, v) => sum + (v.views ?? 0), 0)),
            likes: counted.reduce((sum, v) => sum + (v.likes ?? 0), 0),
            bonus: money(counted.reduce((sum, v) => sum + (d.bonusByVideo.get(v.id) ?? 0), 0)),
            best: counted.length
              ? fmtViews(Math.max(...counted.map((v) => v.views ?? 0)))
              : null,
          };
        }).filter((row) => row.videos > 0),

        // the whole history is not worth the tokens; the live end of it is.
        recent_videos: d.videos.slice(0, 20).map((v) => ({
          id: v.id,
          platform: v.platform,
          posted: v.posted_at ? shortDate(v.posted_at) : null,
          views: fmtViews(v.views ?? 0),
          bonus: money(d.bonusByVideo.get(v.id) ?? 0),
        })),
        totals: {
          views: fmtViews(d.totalViews),
          flat: money(d.flatCents),
          bonus: money(d.bonusCents),
          base_videos: d.baseVideos,
        },
      };
    }

    case "get_earnings": {
      const only = str(input.deal_id);
      const rows = await loadDeals();
      const scoped = rows.filter((r) => !only || r.deal.id === only);

      const earned = scoped.reduce((sum, r) => sum + r.earnedCents, 0);
      const paid = scoped.reduce((sum, r) => sum + r.paidCents, 0);

      return {
        source: "public.deal_earnings, computed in postgres. Report it, do not recompute it.",
        total: { earned: money(earned), paid: money(paid), owed: money(earned - paid) },
        by_deal: scoped.map((r) => ({
          deal_id: r.deal.id,
          brand: r.brand.name,
          flat: money(r.flatCents),
          bonus: money(r.bonusCents),
          earned: money(r.earnedCents),
          paid: money(r.paidCents),
          owed: money(r.earnedCents - r.paidCents),
        })),
      };
    }

    default:
      return { error: `Unknown read tool: ${name}` };
  }
}

/** Handy for the write side, which stores platforms as an array of these. */
export const isPlatform = (v: unknown): v is Platform =>
  v === "tiktok" || v === "instagram" || v === "youtube";
