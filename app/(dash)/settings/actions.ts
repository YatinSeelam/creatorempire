"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { KEY_PROVIDERS, type KeyProvider } from "@/lib/api-keys";
import { getBilling } from "@/lib/billing";
import { normalizePhone } from "@/lib/notify";
import { CE_ORG_ID } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  navOn,
  readNavPrefs,
  writeNavPrefs,
  NAV_COOKIE,
  NAV_COOKIE_MAX_AGE,
} from "@/lib/nav-prefs";
import { readTheme, THEME_COOKIE, THEME_COOKIE_MAX_AGE } from "@/lib/theme";
import { readTz, TZ_COOKIE, TZ_COOKIE_MAX_AGE } from "@/lib/tz";

export type SettingsState = { error?: string; ok?: string };

/** Only these three notification columns can be flipped from the ui. */
const TOGGLES = ["notify_deals", "notify_edits", "notify_posts"] as const;
type Toggle = (typeof TOGGLES)[number];

function clean(value: FormDataEntryValue | null, max: number) {
  const text = String(value ?? "").trim();
  return text.slice(0, max) || null;
}

/**
 * Saves the profile fields. The write runs as the signed-in user, and the
 * update grant on public.profiles is column-scoped, so this cannot touch
 * anything privileged even if the form is tampered with.
 */
export async function saveProfile(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Your session expired. Sign in again." };

  const handle = clean(formData.get("handle"), 40);

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: clean(formData.get("full_name"), 80),
      handle: handle ? handle.replace(/^@+/, "") : null,
      niche: clean(formData.get("niche"), 120),
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { ok: "Saved." };
}

export async function setNotification(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const key = String(formData.get("key") ?? "") as Toggle;
  if (!TOGGLES.includes(key)) return { error: "Unknown setting." };

  const next = formData.get("next") === "on";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Your session expired. Sign in again." };

  const { error } = await supabase
    .from("profiles")
    .update({ [key]: next })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}

/**
 * The number, for texts that do not send yet.
 *
 * Collected now because the number is the slow half: people give it once, and
 * having it already means switching sms on later is a deploy rather than a
 * campaign asking everybody to come back and type it.
 *
 * Saving a number does NOT turn texts on. `notify_sms` stays false and the
 * toggle beside it stays disabled until there is something behind it — a
 * switch that says "on" while nothing sends is a worse lie than a switch that
 * says "soon". `phone_verified_at` is not grantable from a session at all: a
 * typed number is a claim, and only a code we sent and they returned makes it
 * a fact.
 */
export async function savePhone(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const raw = String(formData.get("phone") ?? "").trim();
  // an emptied box is "forget my number", not a validation failure
  if (!raw) {
    const { error } = await supabase
      .from("profiles")
      .update({ phone: null })
      .eq("id", user.id);
    if (error) return { error: error.message };
    revalidatePath("/settings");
    return { ok: "Number removed." };
  }

  const phone = normalizePhone(raw);
  if (!phone) return { error: "That does not look like a phone number." };

  const { error } = await supabase
    .from("profiles")
    .update({ phone })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { ok: "Saved. We will text you the moment it is switched on." };
}

/**
 * Delete the account, and everything on it.
 *
 * Every user table cascades off auth.users, so one admin delete takes the
 * deals, videos, payouts, brands, posts, portfolio, threads and seats with it.
 * Two things stop it first, because a cascade cannot undo either:
 *
 * - a plan that is still billing. the subscriptions row would go, stripe would
 *   keep charging, and there is nobody left to email the invoice to. cancel
 *   first (through us, there is no portal), then delete.
 * - a workspace they own that other people sit on. `orgs.owner_id` cascades,
 *   which would take a whole agency and its roster's seats down with one
 *   person's account. remove the others or hand the workspace over first.
 *
 * The typed confirmation is checked here, not just in the button, so a replayed
 * form cannot do it either.
 */
export async function deleteAccount(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== "delete") {
    return { error: 'Type "delete" to confirm.' };
  }

  const billing = await getBilling(supabase, user.id);
  if (billing.paid) {
    return {
      error: "Your plan is still active. Cancel it first (settings → billing), then delete.",
    };
  }

  // rls hands an owner every seat on their own orgs, so this counts the other
  // people sitting on anything they own.
  const { data: owned } = await supabase.from("orgs").select("id, name").eq("owner_id", user.id);
  const ownedIds = (owned ?? []).map((o) => o.id as string);
  if (ownedIds.length > 0) {
    const { count } = await supabase
      .from("org_members")
      .select("user_id", { count: "exact", head: true })
      .in("org_id", ownedIds)
      .neq("user_id", user.id);
    if ((count ?? 0) > 0) {
      return {
        error: `You own ${
          ownedIds.length === 1 ? `the ${owned![0].name} workspace` : "workspaces"
        } that other people are on. Remove them or delete the workspace first.`,
      };
    }
  }

  const service = createServiceClient();
  if (!service) return { error: "Account deletion is not switched on here yet. Email support and we will do it by hand." };

  const { error } = await service.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };

  // the session is already dead server side; this clears the cookies so the
  // next request does not try to refresh a token for a user that is gone.
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}


/**
 * Light, dark, or follow the device.
 *
 * A cookie write and nothing else — no session read, no database. The value is
 * run through `readTheme` rather than trusted, because a cookie is a string
 * anybody can set and this one ends up inside a `data-theme` attribute; the
 * three known words are the only three that get through.
 *
 * `httpOnly: false` on purpose. The picker flips the attribute on the shell
 * itself for an instant answer and this write is what makes it survive a
 * reload, so the two have to agree — and there is nothing to protect here: it
 * is a colour scheme, not a capability.
 *
 * `revalidatePath("/", "layout")` because the attribute is rendered by the two
 * app layouts, and a cached shell would come back in the old theme on the next
 * navigation even though the cookie had changed.
 */
export async function setTheme(formData: FormData): Promise<void> {
  const theme = readTheme(String(formData.get("theme") ?? ""));

  (await cookies()).set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });

  revalidatePath("/", "layout");
}

/** The browser's zone, written by `TzSync`. No revalidate: the component
 *  refreshes the page it is on itself, and nothing cached depends on it. */
export async function setTimezone(formData: FormData): Promise<void> {
  const tz = readTz(String(formData.get("tz") ?? ""));
  (await cookies()).set(TZ_COOKIE, tz, {
    path: "/",
    maxAge: TZ_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });
}


/**
 * Show or hide one section of the app.
 *
 * Reads the cookie, flips one id, writes the whole thing back — rather than
 * taking the full map from the form. A form that posts every switch is a form
 * where two tabs open on settings each write the other's stale answers back
 * over the live ones, and this is a preference somebody will absolutely leave
 * open in a second tab.
 *
 * `readNavPrefs` drops any id this build does not know, so a hand-edited cookie
 * cannot smuggle a row in, and `navOn` is what supplies the default for an id
 * nobody has voted on yet — including Flow, which starts off.
 *
 * This hides things. It is NOT a permission: `/flow` and every tool route still
 * answer, exactly as they do when an org switches a card off. The gate on those
 * pages is their own.
 */
export async function toggleNavSection(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const jar = await cookies();
  const prefs = readNavPrefs(jar.get(NAV_COOKIE)?.value);

  // no id, or one this build does not know: `navOn` would answer for a row that
  // does not exist and `writeNavPrefs` would drop it again on the way out.
  if (!id) return;

  const next = writeNavPrefs({ ...prefs, [id]: !navOn(prefs, id) });

  jar.set(NAV_COOKIE, next, {
    path: "/",
    maxAge: NAV_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });

  // the rail is rendered by the layout, so the layout is what has to be redrawn.
  revalidatePath("/", "layout");
}

/**
 * Save one workspace api key.
 *
 * The secret goes straight into `set_api_credential`, which puts it in vault
 * and keeps only a four character hint on the row. Nothing here writes a table
 * and nothing here can read a key back: the read is granted to `service_role`
 * alone, so even this action, running as the signed-in owner, could not show
 * somebody the key they just saved.
 */
export async function saveApiKey(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const provider = String(formData.get("provider") ?? "");
  const secret = String(formData.get("secret") ?? "").trim();

  if (!KEY_PROVIDERS.includes(provider as KeyProvider)) {
    return { error: "Unknown provider." };
  }
  // an empty save is a slipped keystroke, not an instruction to unset a
  // working key. clearing has its own button.
  if (!secret) return { error: "Paste the key first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_api_credential", {
    p_provider: provider,
    p_secret: secret,
    p_org: CE_ORG_ID,
  });

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { ok: "Saved." };
}

/** Drop a key, ciphertext and all. The deploy's own env takes over again. */
export async function clearApiKey(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const provider = String(formData.get("provider") ?? "");
  if (!KEY_PROVIDERS.includes(provider as KeyProvider)) {
    return { error: "Unknown provider." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_api_credential", {
    p_provider: provider,
    p_org: CE_ORG_ID,
  });

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { ok: "Removed." };
}
