/**
 * What flow is made of. Pure types, client safe, no database client anywhere
 * near it so a proposal card can import the shape it renders.
 */

export type RiskTier = "safe" | "review" | "money";

export type TargetEntity =
  | "deal"
  | "brand"
  | "bonus_rule"
  | "deal_account";

export type ProposalStatus = "proposed" | "accepted" | "rejected" | "applied" | "failed";

/** The label on the card, per entity. One place, so the four never drift. */
export const ENTITY_LABEL: Record<TargetEntity, string> = {
  deal: "New deal",
  brand: "Brand edit",
  bonus_rule: "Bonus rule",
  deal_account: "Tracked account",
};

/** What the same entity is called when the card changes one rather than makes one. */
const UPDATE_LABEL: Partial<Record<TargetEntity, string>> = {
  deal: "Deal edit",
  brand: "Brand edit",
};

/** And when the card removes one for good. */
const DELETE_LABEL: Partial<Record<TargetEntity, string>> = {
  deal: "Delete deal",
};

/**
 * The heading on a card. An edit says so out loud, because "New deal" over a
 * change to a deal that already exists is the one misread that gets a creator
 * to press accept without looking. A delete even more so.
 */
export function proposalLabel(p: Pick<Proposal, "target_entity" | "op">): string {
  return (
    (p.op === "update"
      ? UPDATE_LABEL[p.target_entity]
      : p.op === "delete"
        ? DELETE_LABEL[p.target_entity]
        : null) ?? ENTITY_LABEL[p.target_entity]
  );
}

export type Proposal = {
  id: string;
  thread_id: string;
  target_entity: TargetEntity;
  target_id: string | null;
  op: "create" | "update" | "delete";
  /** the same loose shape the matching form posts. never trusted, always normalised. */
  patch: Record<string, unknown>;
  evidence: string | null;
  confidence: number | null;
  risk_tier: RiskTier;
  dedupe_key: string | null;
  status: ProposalStatus;
  error: string | null;
  created_at: string;
  applied_at: string | null;
};

export type Thread = {
  id: string;
  title: string | null;
  page_ref: string | null;
  last_message_at: string;
  created_at: string;
};

/**
 * A message as the model sees it. `content` is the anthropic block array
 * verbatim — text, images and tool calls all live in there, because a column
 * per block kind stops working the first time a new kind ships.
 */
export type FlowMessage = {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: ContentBlock[];
  created_at: string;
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: string; [key: string]: unknown };

/** Only what the browser needs to draw a turn. Tool noise stays on the server. */
export type VisibleTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  images: number;
  /**
   * One url per image on the turn, in block order, pointing at
   * `/api/flow/image/<message id>?i=<block index>`.
   *
   * Urls rather than the base64 itself: the bytes are already in
   * `ai_messages.content`, and inlining a few screenshots as data urls would put
   * megabytes of base64 in the page payload of every thread that ever had one
   * attached. The route reads the same row under the same rls.
   */
  previews: string[];
  created_at: string;
};

/**
 * What the composer streams back. One frame per line, `data: <json>\n\n`.
 *
 * `text` is the only one that arrives many times. `proposal` and `done` land
 * once each, and `error` ends the stream in place of `done`.
 *
 * `tool` and `tool_done` come in pairs and are what the activity list above the
 * answer is drawn from. A read that takes three seconds is three seconds of a
 * blank screen otherwise, and "reading your deals" is the difference between a
 * slow answer and a broken one.
 */
export type FlowFrame =
  | { type: "thread"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "tool_done"; name: string; ok: boolean; detail?: string | null }
  | { type: "proposal"; proposal: Proposal }
  | { type: "applied"; proposal: Proposal }
  | { type: "done"; text: string }
  | { type: "error"; message: string };
