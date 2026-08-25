/**
 * PayPal Payouts. The one thing in this product that moves real money out,
 * so it is deliberately small and says no a lot.
 *
 * Why PayPal AS WELL AS Stripe (lib/payouts/stripe-connect.ts). This comment
 * used to say Connect could not reach the Philippines, Pakistan, Bangladesh or
 * Nigeria. That was wrong, and it was wrong in a way that parked a real
 * requirement: `GET /v1/country_specs/US` reports 120 supported transfer
 * countries and the first three of those four are on it.
 *
 * The real difference is what the recipient needs. Stripe pays a bank account
 * or a debit card and only after the editor has been through stripe's identity
 * checks. PayPal Payouts sends to any PayPal address with no onboarding on the
 * recipient's side, which is why it stays the default: an editor pastes an
 * email and gets paid. It is also the only rail for Brazil and Nepal, which
 * Connect genuinely does not reach from a US platform.
 *
 * Server only. With PAYPAL_CLIENT_ID / PAYPAL_SECRET unset every call returns
 * a refusal instead of throwing, so a deploy without credentials degrades to
 * "ask a human" rather than to a crash.
 *
 * Sandbox unless PAYPAL_ENV is exactly "live". That default is on purpose:
 * the failure mode of guessing wrong should be fake money, not real money.
 */

const LIVE = "https://api-m.paypal.com";
const SANDBOX = "https://api-m.sandbox.paypal.com";

function base(): string {
  return process.env.PAYPAL_ENV === "live" ? LIVE : SANDBOX;
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
}

/** Which methods this module can actually send to. */
export function canAutoSend(method: string): boolean {
  // PayPal's payout api takes an email address; venmo goes through the same
  // rail in the US. cash app and wise have no api we hold keys for, so they
  // stay a human job and the ui says so.
  return method === "paypal" || method === "venmo";
}

type TokenResult = { token: string } | { error: string };

async function accessToken(): Promise<TokenResult> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) return { error: "paypal is not configured" };

  try {
    const res = await fetch(`${base()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { error: `paypal auth failed (${res.status})` };
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) return { error: "paypal returned no token" };
    return { token: json.access_token };
  } catch (err) {
    return {
      error: `paypal auth unreachable: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

export type PayoutResult =
  | { ok: true; batchId: string }
  | { ok: false; error: string };

/**
 * Send one payout.
 *
 * `senderBatchId` is our own batch uuid and it is the idempotency key: PayPal
 * rejects a batch id it has already seen, so a retry that reaches them twice
 * pays once. That guarantee is why the caller must claim the batch in the
 * database BEFORE calling this, never after.
 */
export async function sendPayout(input: {
  senderBatchId: string;
  email: string;
  amountCents: number;
  note: string;
}): Promise<PayoutResult> {
  if (input.amountCents <= 0) return { ok: false, error: "nothing to send" };

  const auth = await accessToken();
  if ("error" in auth) return { ok: false, error: auth.error };

  const value = (input.amountCents / 100).toFixed(2);

  try {
    const res = await fetch(`${base()}/v1/payments/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
        // paypal's own idempotency header, belt and braces with the batch id
        "PayPal-Request-Id": input.senderBatchId,
      },
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: input.senderBatchId,
          email_subject: "you got paid, ugc flows",
          email_message: input.note.slice(0, 400),
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: { value, currency: "USD" },
            receiver: input.email,
            note: input.note.slice(0, 400),
            sender_item_id: input.senderBatchId,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const json = (await res.json().catch(() => ({}))) as {
      batch_header?: { payout_batch_id?: string };
      message?: string;
      name?: string;
      details?: { issue?: string; description?: string }[];
    };

    if (!res.ok) {
      const detail =
        json.details?.[0]?.description ??
        json.details?.[0]?.issue ??
        json.message ??
        json.name ??
        `http ${res.status}`;
      return { ok: false, error: String(detail).slice(0, 300) };
    }

    const batchId = json.batch_header?.payout_batch_id;
    if (!batchId) return { ok: false, error: "paypal accepted it but returned no id" };

    return { ok: true, batchId };
  } catch (err) {
    // A timeout here is the dangerous case: the money may or may not have
    // left. The caller leaves the batch 'sending' on an unknown outcome
    // rather than releasing it, because paying twice is worse than a payout
    // that needs a human to look at it once.
    return {
      ok: false,
      error: `unknown: ${err instanceof Error ? err.message : "paypal unreachable"}`,
    };
  }
}
