import { NextResponse } from "next/server";
import { syncStripeAccount } from "@/app/editors/actions";
import { createClient } from "@/lib/supabase/server";
import { BASE_PATH } from "@/lib/base-path";

/**
 * Where stripe sends an editor back after onboarding.
 *
 * It is both the `return_url` and the `refresh_url`, on purpose. Stripe uses
 * refresh when a link expires before it was used, and the right answer to that
 * is the same as the right answer to finishing: come back here, and the panel
 * either says connected or offers the button again.
 *
 * The reason this exists rather than a bare redirect is that it pulls the
 * account state before rendering anything. `account.updated` is the event that
 * catches a verification finishing hours later, but it needs a Connect webhook
 * subscribed with its own signing secret, and until that is set up this route
 * is the only thing that ever learns `payouts_enabled` flipped. With both, the
 * editor sees the truth on the screen they are already looking at.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // back to the payouts page, not the desk: the connect panel they pressed the
  // button on lives there now, and landing on the desk hides the one thing they
  // came back to check.
  // BASE_PATH because an absolute second argument wipes the prefix `request.url`
  // came in with, and stripe sends people back through the public host.
  const home = new URL(`${BASE_PATH}/editors/payouts`, request.url);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL(`${BASE_PATH}/login?next=/editors/payouts`, request.url)
    );
  }

  const { data: row } = await supabase
    .from("editor_stripe_accounts")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const accountId = row?.account_id as string | undefined;
  if (accountId) {
    // best effort. a failed read here leaves the row as it was and the webhook
    // or the next visit corrects it; it must never cost them the redirect.
    await syncStripeAccount(user.id, accountId);
  }

  home.searchParams.set("stripe", "back");
  return NextResponse.redirect(home);
}
