// The database and stripe half of credits: balance, ledger, checkout.
// Server only. Reads run as the signed-in user (RLS scopes them), the
// checkout call is a raw fetch against stripe's form api, same
// no-sdk decision as the webhook.

import { packById, type CreditPack, type LedgerRow } from "@/lib/credits";
import { createClient } from "@/lib/supabase/server";

/** The wallet, computed by the db so a stale cache can never oversell. */
export async function loadCreditBalance(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("job_credit_balance");
  if (error) return 0;
  return Number(data ?? 0);
}

export async function loadCreditLedger(limit = 60): Promise<LedgerRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_credit_ledger")
    .select("id, delta, kind, job_id, memo, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as LedgerRow[];
}

/**
 * A stripe checkout session for one credit pack, built with price_data so no
 * products need to exist in the stripe dashboard. The metadata is what the
 * webhook branches on: kind says "this is credits, not the subscription", the
 * pack id is looked up again server-side before any credits are granted.
 */
export async function createPackCheckout(input: {
  pack: CreditPack;
  userId: string;
  email: string | null;
  origin: string;
}): Promise<{ url: string } | { error: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { error: "stripe is not configured yet. add STRIPE_SECRET_KEY." };

  // the id round-trips through our own list, never trusting the caller's shape
  const pack = packById(input.pack.id);
  if (!pack) return { error: "unknown pack." };

  const body = new URLSearchParams({
    mode: "payment",
    client_reference_id: input.userId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(pack.priceCents),
    "line_items[0][price_data][product_data][name]": `${pack.credits} editing credits`,
    "metadata[kind]": "job_credits",
    "metadata[pack]": pack.id,
    success_url: `${input.origin}/editing/credits?paid=1`,
    cancel_url: `${input.origin}/editing/credits`,
  });
  if (input.email) body.set("customer_email", input.email);

  let res: Response;
  try {
    res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch {
    return { error: "could not reach stripe. try again." };
  }

  const session = (await res.json().catch(() => null)) as {
    url?: string;
    error?: { message?: string };
  } | null;

  if (!res.ok || !session?.url) {
    console.error("[credits] checkout session failed", session?.error?.message);
    return { error: "stripe rejected the checkout. try again in a minute." };
  }

  return { url: session.url };
}
