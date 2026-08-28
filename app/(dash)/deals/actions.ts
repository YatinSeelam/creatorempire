"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { applyDealDraft } from "@/lib/deal-intake";
import { emailForUser, notificationHtml, sendEmail } from "@/lib/email/send";
import {
  normalizeBrand,
  normalizeDeal,
  normalizeDealDraft,
  readDealForm,
} from "@/lib/deal-schema";
import { PLATFORMS, type MilestoneTier, type Platform } from "@/lib/deals";
import { parseHandle, parsePostUrl, resolveShortLink } from "@/lib/ingest/urls";
import { dueAccounts, syncAccount, thawDeal, type SyncResult } from "@/lib/ingest/sync";
import { parseCents, parseCentsOrZero, parseCount, shortDate, today } from "@/lib/money";
import { absoluteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { dealScope, loadWorkspace } from "@/lib/workspace";

export type DealState = { error?: string; ok?: string };

/**
 * Every write runs as the signed-in user against RLS, so the only thing an
 * action has to prove is that somebody is signed in. The `user_id` written into
 * each row is read from the session, never from the form.
 */
async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const text = (value: FormDataEntryValue | null, max: number): string | null => {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
};

const date = (value: FormDataEntryValue | null): string | null => {
  const out = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
};

const oneOf = <T extends string>(value: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T => {
  const out = String(value ?? "");
  return (allowed as readonly string[]).includes(out) ? (out as T) : fallback;
};

// -------------------------------------------------------------------- deals

/**
 * Create a deal, its brand and the accounts it posts from, in one submit.
 *
 * The action itself does no parsing and no writing. `normalizeDealDraft` turns
 * the form into a validated draft and `applyDealDraft` turns that draft into
 * rows, and both of those are reachable from somewhere that is not a form. That
 * is deliberate: the AI brain-dump feature proposes a `DealDraft` and applies it
 * through this same pair, so there is exactly one definition of what a valid
 * deal is and exactly one path that writes one.
 */
export async function createDeal(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const parsed = normalizeDealDraft(readDealForm(formData));
  if (!parsed.ok) return { error: parsed.error };

  // the deal lands on the books being looked at: the creator's own, or the
  // agency seat they switched into before opening the form.
  const { orgId } = await dealScope();
  const result = await applyDealDraft(supabase, user.id, parsed.draft, orgId);
  if (!result.ok) return { error: result.error };

  // The first bonus, written in the same submit as the deal.
  //
  // The rule cannot go in the draft: a bonus needs a deal_id and the deal does
  // not have one until the line above. So the wizard carries the bonus form
  // under a `rule_` prefix — one `<form>` cannot hold two fields called
  // `ends_on` and mean different dates by them — and it is stripped back off
  // here and handed to the same `readRuleForm` the standalone bonus form uses.
  // One definition of a valid rule, two ways in.
  //
  // A rule that will not parse never takes the deal down with it: the deal is
  // already written, so a bad one is named in the note and typed again on the
  // edit page. Failing the whole submit here would invite a second deal.
  const notes = [result.warning].filter((n): n is string => Boolean(n));
  if (String(formData.get("rule_on") ?? "") === "1") {
    const ruleData = new FormData();
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("rule_") && key !== "rule_on") ruleData.append(key.slice(5), value);
    }

    const rule = readRuleForm(ruleData);
    if ("error" in rule) {
      notes.push(`The bonus did not save: ${rule.error} Add it below.`);
    } else {
      const { error } = await supabase
        .from("bonus_rules")
        .insert({ ...rule.row, user_id: user.id, deal_id: result.dealId });
      if (error) notes.push(`The bonus did not save: ${error.message} Add it below.`);
    }
  }

  revalidatePath("/deals");
  // the deal exists either way, so the redirect happens either way. a note that
  // an account did not attach travels in the url rather than dying here, because
  // leaving the creator on the form invites a second identical deal.
  const note = notes.join(" ");
  const query = note ? `?note=${encodeURIComponent(note)}` : "";
  // "also connect these for autoposting", ticked on the wizard's last step. An
  // Upload-Post profile is one row per (creator, deal), so the wizard has
  // nothing to connect to while the deal is still a form; the tick is a
  // destination rather than a setting, and it lands on the accounts section
  // that holds the connect buttons instead of the deal's numbers.
  const connectAfter = String(formData.get("connect_after") ?? "") === "1";
  redirect(`/deals/${result.dealId}${connectAfter ? `/edit${query}#accounts` : query}`);
}

export async function updateDeal(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const id = text(formData.get("deal_id"), 40);
  if (!id) return { error: "Missing deal." };

  // same normaliser the create path uses, so the two can never disagree about
  // what a valid flat fee or a valid date range is.
  const parsed = normalizeDeal(readDealForm(formData));
  if (!parsed.ok) return { error: parsed.error };

  const { error } = await supabase.from("deals").update(parsed.deal).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/deals/${id}`, "layout");
  revalidatePath("/deals");
  return { ok: "Saved." };
}

/**
 * Move a deal between the creator's own books and an agency seat they hold.
 *
 * `org_id` is the only column that changes. The seat is checked here against
 * the workspace's own list AND by a trigger in the database, so a tampered
 * form cannot file a deal under a stranger's roster. After the move the deal
 * lives on the other workspace, so the redirect goes to the list rather than
 * back to a page that would now 404 in this one.
 */
export async function moveDeal(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const id = text(formData.get("deal_id"), 40);
  if (!id) return;

  const raw = String(formData.get("org_id") ?? "").trim();
  const ws = await loadWorkspace();
  const orgId = raw && ws.seats.some((s) => s.id === raw) ? raw : null;

  const { error } = await supabase.from("deals").update({ org_id: orgId }).eq("id", id);
  if (error) return;

  revalidatePath("/deals");
  revalidatePath("/dashboard");
  revalidatePath(`/deals/${id}`, "layout");
  const note = orgId
    ? `Moved to ${ws.seats.find((s) => s.id === orgId)?.name ?? "the workspace"}. Switch into it to see the deal on its list.`
    : "Moved to your own account.";
  redirect(`/deals/${id}?note=${encodeURIComponent(note)}`);
}

/**
 * The brand behind the deal. Editing it changes every deal that points at it,
 * which is the whole reason brands are their own table.
 */
export async function updateBrand(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const id = text(formData.get("brand_id"), 40);
  if (!id) return { error: "Missing brand." };

  const parsed = normalizeBrand({
    name: formData.get("name"),
    website: formData.get("website"),
    contact_name: formData.get("contact_name"),
    contact_email: formData.get("contact_email"),
    logo_key: formData.get("logo_key"),
    logo_url: formData.get("logo_url"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const { error } = await supabase.from("brands").update(parsed.brand).eq("id", id);

  if (error) {
    // the unique index is on (user_id, lower(name)), so this is a rename onto a
    // brand that already exists rather than anything the creator can retry.
    return {
      error:
        error.code === "23505"
          ? `You already have a brand called ${parsed.brand.name}.`
          : error.message,
    };
  }

  const dealId = text(formData.get("deal_id"), 40);
  if (dealId) revalidatePath(`/deals/${dealId}`, "layout");
  revalidatePath("/deals");
  return { ok: "Saved." };
}

/**
 * The delete itself, separated from the form action so flow's accept path can
 * call it too. The form wants a redirect; a proposal wants an answer. Both run
 * the same read-then-delete under the same RLS, so a deal that is not yours and
 * a deal that is already gone are the same "nothing was changed".
 */
export async function destroyDeal(dealId: string): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };
  if (!dealId) return { error: "Missing deal." };

  const { data: row } = await supabase.from("deals").select("id").eq("id", dealId).maybeSingle();
  if (!row) return { error: "That deal is gone. Nothing was changed." };

  // cascades through accounts, rules, videos and snapshots by foreign key.
  const { error } = await supabase.from("deals").delete().eq("id", dealId);
  if (error) return { error: error.message };

  revalidatePath("/deals");
  return { ok: "Deal deleted." };
}

export async function deleteDeal(formData: FormData): Promise<void> {
  const id = text(formData.get("deal_id"), 40);
  if (!id) return;

  const state = await destroyDeal(id);
  if (state.error) return;

  redirect("/deals");
}

// ------------------------------------------------------------------ accounts

export async function addAccount(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const dealId = text(formData.get("deal_id"), 40);
  if (!dealId) return { error: "Missing deal." };

  const platform = oneOf(formData.get("platform"), PLATFORMS, "tiktok");
  const raw = text(formData.get("handle"), 200);
  if (!raw) return { error: "Add the handle or the profile link." };

  // a pasted profile url is the common case, so it is read rather than rejected.
  const handle = parseHandle(raw, platform);
  if (!handle) return { error: "That does not look like a handle or a profile link." };

  const { error } = await supabase.from("deal_accounts").insert({
    user_id: user.id,
    deal_id: dealId,
    platform,
    handle,
    source: oneOf(formData.get("source"), ["scrape", "oauth", "manual"] as const, "scrape"),
  });

  if (error) {
    // the unique key is (deal_id, platform): a deal runs one account per
    // platform, so this is "you already have a tiktok here", not "duplicate".
    return {
      error:
        error.code === "23505"
          ? `This deal already has a ${platform} account. Remove it first to swap it.`
          : error.message,
    };
  }

  revalidatePath(`/deals/${dealId}`, "layout");
  return { ok: `@${handle} added.` };
}

export async function removeAccount(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const id = text(formData.get("account_id"), 40);
  const dealId = text(formData.get("deal_id"), 40);
  if (!id) return;

  await supabase.from("deal_accounts").delete().eq("id", id);
  if (dealId) revalidatePath(`/deals/${dealId}`, "layout");
}

// --------------------------------------------------------------- bonus rules

/**
 * The tier table: a views box and a dollars box per row, posted as two parallel
 * lists. A row with either side blank is skipped rather than rejected, because
 * the form ships with a full sheet of empty rows and a creator whose deal has
 * three tiers should not have to delete the other five.
 *
 * A row with one side filled and the other blank is the one thing that IS an
 * error: it means a tier was half typed, and silently dropping it would quietly
 * lose money at exactly the view count somebody cared enough to type.
 */
function parseTierRows(
  views: string[],
  amounts: string[]
): MilestoneTier[] | "half" | "descending" | null {
  const tiers: MilestoneTier[] = [];

  for (let i = 0; i < Math.max(views.length, amounts.length); i += 1) {
    const left = (views[i] ?? "").trim();
    const right = (amounts[i] ?? "").trim();
    if (!left && !right) continue;
    if (!left || !right) return "half";

    const at = parseCount(left);
    const cents = parseCents(right);
    if (at === null || cents === null) return null;
    tiers.push({ views: at, amount_cents: cents });
  }

  // sorted ascending so `describeRule` can read the top tier off the end and the
  // stored order matches the order a human would write them in.
  tiers.sort((a, b) => a.views - b.views);

  // a ladder where a higher tier pays less is almost always a typo, and it is
  // the one shape where the payout sql (max amount reached) and the preview
  // (last tier reached) disagree. refuse it before it becomes a number two
  // screens argue about.
  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i].amount_cents < tiers[i - 1].amount_cents) return "descending";
  }

  return tiers.length > 0 ? tiers : null;
}

/**
 * The whole bonus form, parsed into a row, once.
 *
 * Add and edit post the identical form, so they share the identical parser. Two
 * copies of this is how a rule saves one way when it is created and a different
 * way when it is corrected, which on a money table is a silent repricing rather
 * than a bug somebody notices.
 *
 * Every column the form can set is written on every save, including the ones the
 * chosen kind does not use. That is what lets a milestone rule be switched to a
 * CPM without the old `tiers` array staying behind to be read by a later change
 * of mind.
 */
function readRuleForm(formData: FormData): { row: Record<string, unknown> } | { error: string } {
  const kind = oneOf(formData.get("kind"), ["cpm", "per_video", "milestone"] as const, "cpm");
  const windowKind = oneOf(
    formData.get("window_kind"),
    ["forever", "absolute", "since_post"] as const,
    "forever"
  );

  const platforms = formData
    .getAll("platforms")
    .map(String)
    .filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));

  const row: Record<string, unknown> = {
    label: text(formData.get("label"), 80),
    kind,
    platforms,
    min_views: parseCount(formData.get("min_views")) ?? 0,
    cap_cents: parseCents(formData.get("cap")),
    window_kind: windowKind,
    // both default to what every rule written before them already did, so an
    // untouched form saves the old behaviour rather than a new one.
    tier_mode: oneOf(formData.get("tier_mode"), ["add", "replace"] as const, "add"),
    view_counting: oneOf(
      formData.get("view_counting"),
      ["per_video", "highest", "combined"] as const,
      "per_video"
    ),
    // cleared unless the kind below claims them back, so switching kinds cannot
    // leave a stale rate on a tier sheet.
    rate_cents_per_1k: null,
    amount_cents: null,
    tiers: [],
    starts_on: null,
    ends_on: null,
    window_days: null,
  };

  if (kind === "cpm") {
    // a CPM is dollars per thousand views, so the field is a dollar field like
    // every other one here. $1 CPM is stored as 100 cents per 1k.
    const rate = parseCents(formData.get("rate"));
    if (rate === null) return { error: "Give the CPM as dollars per 1,000 views." };
    row.rate_cents_per_1k = rate;
  } else if (kind === "per_video") {
    const amount = parseCents(formData.get("amount"));
    if (amount === null) return { error: "Give the amount per video." };
    row.amount_cents = amount;
  } else {
    const tiers = parseTierRows(
      formData.getAll("tier_views").map(String),
      formData.getAll("tier_amount").map(String)
    );
    if (tiers === "half") {
      return { error: "One tier has a view count with no pay, or the other way round." };
    }
    if (tiers === "descending") {
      return { error: "A higher tier can't pay less than the one under it." };
    }
    if (!tiers) return { error: "Give at least one tier: a view count and what it pays." };
    row.tiers = tiers;
  }

  if (windowKind === "absolute") {
    const startsOn = date(formData.get("starts_on"));
    if (!startsOn) return { error: "A fixed window needs a start date." };
    row.starts_on = startsOn;
    row.ends_on = date(formData.get("ends_on"));
  } else if (windowKind === "since_post") {
    const days = parseCount(formData.get("window_days"));
    if (!days) return { error: "Say how many days after posting the bonus runs for." };
    row.window_days = days;
  }

  return { row };
}

export async function addRule(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const dealId = text(formData.get("deal_id"), 40);
  if (!dealId) return { error: "Missing deal." };

  const parsed = readRuleForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const { error } = await supabase
    .from("bonus_rules")
    .insert({ ...parsed.row, user_id: user.id, deal_id: dealId });
  if (error) return { error: error.message };

  // a new rule can reopen windows the old ones closed, so let the frozen videos
  // back into the sync before it next runs.
  await thawDeal(supabase, dealId);

  revalidatePath(`/deals/${dealId}`, "layout");
  return { ok: "Bonus added." };
}

/**
 * Correct a rule in place.
 *
 * Until this existed the only way to fix a mistyped tier was to delete the rule
 * and write it again, and a rate sheet with seven tiers is not something anybody
 * retypes to change one of them. It rewrites rather than patches, for the reason
 * in `readRuleForm`: a half-updated rule that still carries the fields of the
 * shape it used to be is the failure worth designing out.
 *
 * The deal is thawed for the same reason an add does it: widening a window or
 * raising a tier can make a frozen video earn again.
 */
export async function editRule(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const ruleId = text(formData.get("rule_id"), 40);
  const dealId = text(formData.get("deal_id"), 40);
  if (!ruleId || !dealId) return { error: "Missing bonus." };

  const parsed = readRuleForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  // rls already scopes this to the signed-in user's rows; the deal_id match is
  // what stops a stale form pointing a rule at a deal it was never on.
  const { error } = await supabase
    .from("bonus_rules")
    .update(parsed.row)
    .eq("id", ruleId)
    .eq("deal_id", dealId);
  if (error) return { error: error.message };

  await thawDeal(supabase, dealId);

  revalidatePath(`/deals/${dealId}`, "layout");
  return { ok: "Bonus saved." };
}

export async function removeRule(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const id = text(formData.get("rule_id"), 40);
  const dealId = text(formData.get("deal_id"), 40);
  if (!id) return;

  await supabase.from("bonus_rules").delete().eq("id", id);
  if (dealId) revalidatePath(`/deals/${dealId}`, "layout");
}

// ------------------------------------------------------------------- videos

/**
 * Paste a link, get a tracked video. The link is matched to one of the deal's
 * accounts by platform, and by handle when the url carries one, so a deal with a
 * tiktok and a youtube needs no dropdown.
 */
export async function addVideo(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const dealId = text(formData.get("deal_id"), 40);
  const raw = text(formData.get("url"), 500);
  if (!dealId || !raw) return { error: "Paste the link to the post." };

  let parsed = parsePostUrl(raw);
  if (parsed?.needsResolve) parsed = (await resolveShortLink(raw)) ?? parsed;

  if (!parsed?.videoId) {
    return { error: "Use a TikTok, Instagram, YouTube or Facebook post link." };
  }

  const { data: accounts } = await supabase
    .from("deal_accounts")
    .select("id, platform, handle")
    .eq("deal_id", dealId)
    .eq("platform", parsed.platform);

  if (!accounts?.length) {
    return { error: `Add a ${parsed.platform} account to this deal first.` };
  }

  const matched =
    (parsed.handle &&
      accounts.find((a) => (a.handle as string).toLowerCase() === parsed!.handle!.toLowerCase())) ||
    accounts[0];

  const { error } = await supabase.from("videos").upsert(
    {
      user_id: user.id,
      deal_id: dealId,
      deal_account_id: matched.id as string,
      platform: parsed.platform,
      platform_video_id: parsed.videoId,
      url: parsed.canonicalUrl,
      content_group: text(formData.get("content_group"), 80),
      posted_at: date(formData.get("posted_on"))
        ? `${date(formData.get("posted_on"))}T12:00:00Z`
        : new Date().toISOString(),
    },
    { onConflict: "deal_account_id,platform_video_id" }
  );

  if (error) return { error: error.message };

  revalidatePath(`/deals/${dealId}`, "layout");
  return { ok: "Tracking it. Numbers land on the next sync." };
}

/**
 * Set what one cut pays, or take it out of the totals.
 *
 * This replaced a bare include/exclude toggle on every row. Both halves of the
 * decision land in one action because they are one decision about one row, and
 * two submits would let somebody set a price on a post they had just excluded.
 * `ignore` writes `videos.counts`, which is the column the earnings functions
 * themselves filter on, so an ignored cut earns nothing in postgres rather than
 * being subtracted afterwards in the app.
 *
 * An empty amount clears the override back to null, which is "use what the rules
 * computed". A typed 0 is stored as 0, and those are genuinely different: null
 * follows the deal if a rule changes, 0 is somebody saying this post pays
 * nothing.
 *
 * Every write takes every `video_id` on the form, because the posts table is one
 * row per edit rather than one row per post: a cut that went out on three
 * platforms has to move all three, or the row's own total stops agreeing with
 * what the deal is paying. The amount goes to all of them identically, and the
 * table reads it back off the cut's lead.
 */
export async function setPostPayment(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const ids = formData
    .getAll("video_id")
    .map((v) => text(v, 40))
    .filter((v): v is string => Boolean(v));
  const dealId = text(formData.get("deal_id"), 40);
  if (ids.length === 0) return { error: "That post is not on this deal any more." };

  const raw = String(formData.get("amount") ?? "").trim();
  // reset comes back as an empty amount AND a cleared ignore, so it is the same
  // write as clearing the field by hand rather than a second path.
  const clear = raw === "" || formData.get("reset") === "on";
  const cents = clear ? null : parseCents(raw);
  if (!clear && cents === null) {
    return { error: "Give the payment as a number, like 150 or 150.50." };
  }

  const { error } = await supabase
    .from("videos")
    .update({
      payment_override_cents: cents,
      counts: formData.get("reset") === "on" ? true : formData.get("ignore") !== "on",
    })
    .in("id", ids);

  if (error) return { error: error.message };

  if (dealId) revalidatePath(`/deals/${dealId}`, "layout");
  return { ok: clear ? "Back to the deal's own amount." : "Saved." };
}

/**
 * Typing the numbers in by hand. The fallback that keeps the product usable when
 * a platform locks a scraper out, and the only path for a private account.
 *
 * It writes the same two places a sync does — the video's latest columns and
 * today's snapshot row — so a hand-entered number earns exactly like a scraped
 * one and the bonus math never has to know which it was.
 */
export async function setVideoStats(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const id = text(formData.get("video_id"), 40);
  const dealId = text(formData.get("deal_id"), 40);
  if (!id) return { error: "Missing video." };

  const views = parseCount(formData.get("views"));
  if (views === null) return { error: "Views has to be a whole number." };

  const likes = parseCount(formData.get("likes")) ?? 0;
  const comments = parseCount(formData.get("comments")) ?? 0;
  const shares = parseCount(formData.get("shares")) ?? 0;
  const day = date(formData.get("day")) ?? today();

  // the cached columns on `videos` are "the newest reading", and the payout
  // sql agrees: base_videos reads the latest video_stats row. writing a
  // BACKDATED entry into the cache would make the posts table disagree with
  // the rollup around the min_views_for_base line, so the cache only moves
  // when this entry is on or after the newest snapshot day.
  const { data: newest } = await supabase
    .from("video_stats")
    .select("day")
    .eq("video_id", id)
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!newest?.day || day >= (newest.day as string)) {
    const { error } = await supabase
      .from("videos")
      .update({ views, likes, comments, shares, last_seen_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return { error: error.message };
  }

  const { error: statsError } = await supabase
    .from("video_stats")
    .upsert(
      { video_id: id, day, user_id: user.id, views, likes, comments, shares },
      { onConflict: "video_id,day" }
    );

  if (statsError) return { error: statsError.message };

  if (dealId) revalidatePath(`/deals/${dealId}`, "layout");
  return { ok: "Updated." };
}

// ------------------------------------------------------------------ refresh

/**
 * Accounts at a time. The providers are already spaced per host inside
 * `lib/ingest/http.ts`, so this is about wall clock rather than politeness:
 * three at a time is what keeps a fifteen account roster inside one request.
 */
const REFRESH_CONC = 3;

/**
 * Stop starting accounts here. The sweep runs inside `after()`, which keeps the
 * invocation alive past the reply but not past the platform's cap, so the
 * budget has to leave room to finish the account in flight, write the receipt
 * and send the email.
 */
const REFRESH_BUDGET_MS = 200_000;

export type RefreshState = DealState & {
  /** what is left after this attempt, so the button can relabel itself. */
  remaining?: number;
  /** ISO date the allowance comes back, for the copy under the button. */
  resetsOn?: string;
};

/**
 * How long the sweep took, in the words somebody would use.
 *
 * Nothing on screen can report this any more — the reply is sent before the
 * sweep starts — so it reads on the email, which is the only place the real
 * duration is now known.
 */
function humanDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

type Claim = {
  id: string | null;
  used: number;
  quota: number;
  remaining: number;
  resets_on: string;
};

/**
 * A provider error, ended so a sentence can be put after it.
 *
 * These are written as fragments on purpose — "usage logging is not set up, so
 * scraping is switched off, so this platform cannot be pulled yet" is a clause
 * that reads well on an account row. Gluing "That still used a refresh." onto
 * it left two sentences with nothing between them.
 */
function sentence(text: string): string {
  const t = text.trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * The "pull everything now" button, and the only manual scrape in the product.
 *
 * The nightly cron leaves an account alone for `SYNC_INTERVAL_DAYS`, which is
 * where the scraper bill went. This is the escape hatch, and it is rationed:
 * `claim_manual_refresh()` takes one off the month's allowance before any
 * provider is touched, and returns a null id when there is none left.
 *
 * It sweeps every account, not one deal. A per-deal button costing the same as
 * a full sweep would only ever be the worse choice, and one that cost nothing
 * would make the allowance decorative.
 *
 * **The reply comes back before the scrape does.** Everything that can be
 * decided for free — the session, the allowance, whether there is anything to
 * pull at all — happens in the request and is answered there. The sweep itself
 * goes to `after()`, so the person is told it started and is free to leave; the
 * numbers land on the rows a few minutes later and an email says so. That is
 * also what makes the failure modes honest: the three checks that can hand the
 * allowance straight back still run before anybody is told they spent one.
 */
export async function refreshEverything(
  _prev: RefreshState,
  _formData: FormData
): Promise<RefreshState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  // claim first. a sweep that checks the allowance afterwards has already spent
  // it, and the number the confirm dialog promised has to be the number charged.
  const { data: claim, error: claimError } = await supabase
    .rpc("claim_manual_refresh")
    .maybeSingle<Claim>();

  if (claimError || !claim) {
    return { error: "Could not check your refresh count. Try again in a minute." };
  }

  if (!claim.id) {
    return {
      error: `No refreshes left. You get ${claim.quota} a month and they come back on ${shortDate(claim.resets_on)}.`,
      remaining: 0,
      resetsOn: claim.resets_on,
    };
  }

  const claimId = claim.id;
  const spent = { remaining: claim.remaining, resetsOn: claim.resets_on };
  const giveBack = async (error: string): Promise<RefreshState> => {
    await supabase.rpc("cancel_manual_refresh", { p_id: claimId });
    return { error, remaining: claim.remaining + 1, resetsOn: claim.resets_on };
  };

  // interval 0 is what makes this a refresh rather than a nudge: every account,
  // however recently it was pulled. rls scopes it to this person's rows.
  const accounts = await dueAccounts(supabase, 500, { intervalDays: 0 }).catch(
    (err: unknown) => (err instanceof Error ? err.message : "Could not read your accounts.")
  );

  if (typeof accounts === "string") return giveBack(accounts);

  // nothing to pull is not worth a refresh, so hand it straight back rather
  // than charging for a no-op.
  if (accounts.length === 0) {
    return giveBack("No tracked accounts on a live deal yet.");
  }

  // rebound after the narrowing above: a hoisted function declaration does not
  // see it, and the worker below is one.
  const queue = accounts;

  /**
   * The sweep itself, handed to `after()` so it outlives the reply.
   *
   * It used to be awaited, which made the browser the thing holding the scrape
   * up: a closed tab, a slept laptop or a flaky connection killed a sweep that
   * had already been paid for, and the dialog had to beg somebody to sit and
   * watch a counter. `after()` runs the callback once the response is on the
   * wire and keeps the serverless invocation alive for it, so leaving the site
   * is no longer an event the sweep can notice.
   *
   * Everything it needs is captured here, before the reply: the account list is
   * already read, and `supabase` carries the session's own token, so the writes
   * still land under rls as this person. Nothing in here may throw out of the
   * callback — an `after` that rejects is an unhandled rejection, not a
   * failed request somebody can retry — so the whole body is wrapped.
   */
  after(async () => {
    const startedAt = Date.now();
    const results: SyncResult[] = [];
    let cursor = 0;

    try {
      async function worker() {
        while (cursor < queue.length) {
          if (Date.now() - startedAt > REFRESH_BUDGET_MS) return;
          const account = queue[cursor++];
          // "manual" is what keeps this on the person's daily cap and off the
          // cron's budget. the ledger row carries it, so the two spends stay
          // tellable apart on the usage page.
          results.push(
            await syncAccount(supabase, account, account.rules, new Date(), { source: "manual" })
          );
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(REFRESH_CONC, queue.length) }, () => worker())
      );

      const seen = results.reduce((n, r) => n + r.seen, 0);
      const apiCalls = results.reduce((n, r) => n + r.apiCalls, 0);
      const failed = results.filter((r) => !r.ok);

      // A sweep that never reached a provider spent nothing, so it owes nothing.
      //
      // "anything that touched a provider is charged" is the rule, and
      // `apiCalls` is what says whether one was touched: it is only written
      // after a fetch comes back, so a `ProviderUnavailable` — no key, no
      // ledger, over the daily cap — leaves it at zero. Without this a deploy
      // missing an env var took one of six refreshes off somebody to tell them
      // about its own configuration, and they could spend the month's
      // allowance without a single outbound call. The reply has already
      // promised the spend by the time this runs, so the refund shows up as a
      // higher count on the next page load rather than in that sentence.
      const refunded =
        results.length > 0 && apiCalls === 0 && failed.length === results.length;

      if (refunded) {
        await supabase.rpc("cancel_manual_refresh", { p_id: claimId });
      } else {
        // the receipt, written whatever the outcome. a sweep where every
        // account failed still made the calls.
        await supabase.rpc("finish_manual_refresh", {
          p_id: claimId,
          p_accounts: results.length,
          p_videos_seen: seen,
          p_api_calls: apiCalls,
        });
      }

      // the numbers are on the rows now, so the two pages that print them have
      // to be rebuilt. this is what a person coming back to an open tab sees.
      revalidatePath("/deals", "layout");
      revalidatePath("/dashboard");

      // the receipt. nobody was watching when this finished, which is the whole
      // point of the change, so the email stopped being a nicety and became the
      // way anybody learns the sweep is done.
      const to = await emailForUser(supabase, user.id, "notify_deals");
      if (!to) return;

      const trouble = failed[0]?.error;
      const lines = refunded
        ? [
            `${sentence(trouble ?? "Every account failed.")}`,
            "Nothing was pulled, so the refresh has been put back on your allowance.",
          ]
        : [
            `${results.length} account${results.length === 1 ? "" : "s"} pulled, ${seen} video${seen === 1 ? "" : "s"} read.`,
          ];

      if (!refunded && failed.length) {
        lines.push(`${failed.length} could not be reached, so those numbers are unchanged.`);
      }
      if (!refunded && cursor < queue.length) {
        lines.push(`${queue.length - cursor} were left for the next run.`);
      }
      if (!refunded) {
        lines.push(`took ${humanDuration(Date.now() - startedAt)}.`);
      }

      await sendEmail({
        to,
        subject: refunded ? "your refresh could not run" : "your numbers are fresh",
        html: notificationHtml({
          heading: refunded ? "your refresh could not run" : "your numbers are fresh",
          lines,
          cta: { label: "see your deals", url: absoluteUrl("/deals") },
        }),
      });
    } catch (err) {
      // a claim left neither finished nor cancelled would eat one of six
      // forever, so the last thing this does is hand it back.
      console.error("[refresh] background sweep failed", err);
      // the builder is thenable rather than a promise, so awaiting it is what
      // gives this a catch to attach to.
      try {
        await supabase.rpc("cancel_manual_refresh", { p_id: claimId });
      } catch {
        // nothing left to try. the receipt row is the record either way.
      }
    }
  });

  // The reply, sent before a single provider has been touched. It can only
  // promise, so it says what was started and roughly how long it takes rather
  // than reporting numbers it does not have yet.
  const roster = `${queue.length} account${queue.length === 1 ? "" : "s"}`;
  const left =
    claim.remaining === 0
      ? `None left until ${shortDate(claim.resets_on)}.`
      : `${claim.remaining} left this month.`;

  return {
    ...spent,
    ok: `Pulling ${roster} now. This takes about five minutes and keeps running if you close the page. ${left}`,
  };
}

// ------------------------------------------------------------------ payouts

/**
 * Freezes what is owed right now into a payout row.
 *
 * The numbers are stored, not referenced. A scrape that backfills a missing day
 * next week must not silently change a bill a brand has already been sent, so a
 * correction becomes an adjustment on a new payout instead.
 */
export async function createPayout(_prev: DealState, formData: FormData): Promise<DealState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const dealId = text(formData.get("deal_id"), 40);
  const periodStart = date(formData.get("period_start"));
  const periodEnd = date(formData.get("period_end"));
  if (!dealId || !periodStart || !periodEnd) return { error: "Give the period start and end." };
  if (periodEnd < periodStart) return { error: "The period ends before it starts." };

  const flat = parseCentsOrZero(formData.get("flat_cents_input"));
  const bonus = parseCentsOrZero(formData.get("bonus_cents_input"));
  const adjust = parseCents(formData.get("adjust_input")) ?? 0;
  if (flat === null || bonus === null) return { error: "Those amounts have to be numbers." };

  const { error } = await supabase.from("payouts").insert({
    user_id: user.id,
    deal_id: dealId,
    period_start: periodStart,
    period_end: periodEnd,
    flat_cents: flat,
    bonus_cents: bonus,
    adjust_cents: adjust,
    notes: text(formData.get("notes"), 500),
  });

  if (error) return { error: error.message };

  revalidatePath(`/deals/${dealId}`, "layout");
  revalidatePath("/deals");
  return { ok: "Payout logged." };
}

export async function setPayoutStatus(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const id = text(formData.get("payout_id"), 40);
  const dealId = text(formData.get("deal_id"), 40);
  const status = oneOf(formData.get("status"), ["due", "invoiced", "paid"] as const, "due");
  if (!id) return;

  await supabase
    .from("payouts")
    .update({
      status,
      invoiced_on: status === "invoiced" ? today() : undefined,
      paid_on: status === "paid" ? today() : null,
    })
    .eq("id", id);

  if (dealId) revalidatePath(`/deals/${dealId}`, "layout");
  revalidatePath("/deals");
}

export async function deletePayout(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const id = text(formData.get("payout_id"), 40);
  const dealId = text(formData.get("deal_id"), 40);
  if (!id) return;

  await supabase.from("payouts").delete().eq("id", id);
  if (dealId) revalidatePath(`/deals/${dealId}`, "layout");
}
