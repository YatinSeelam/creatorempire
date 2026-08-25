/**
 * Stripe Connect, the second rail an editor can withdraw down.
 *
 * Raw fetch, no sdk, same as app/api/stripe/webhook and lib/email/send.ts. The
 * only thing the sdk would buy here is form encoding and a types package, and
 * neither is worth a dependency on the one path in the product that moves real
 * money out.
 *
 * WHAT THIS IS, in the order it happens:
 *
 *   1. an Express account is created for the editor (`acct_...`), asking for
 *      the `transfers` capability and nothing else. We never take charges on
 *      their behalf, we only send them money.
 *   2. they finish stripe's own hosted onboarding through an account link,
 *      where they give stripe their bank account or debit card and whatever
 *      identity documents their country asks for. None of that touches us,
 *      which is the entire reason to use Connect rather than hold bank details.
 *   3. `account.updated` tells us when `payouts_enabled` flips true. Only then
 *      will `claim_payout_batch` hand out that account as a destination.
 *   4. a payout is a Transfer from the platform balance to `acct_...`. Stripe
 *      then pays that balance out to their bank on its own schedule.
 *
 * WHAT IT CANNOT DO, and it is worth knowing before promising anybody:
 * stripe pays bank accounts and debit cards. It cannot pay a PayPal or a Cash
 * App balance, ever. An editor without a local bank account stays on PayPal,
 * which is why `lib/payouts/paypal.ts` is still here and still the default.
 *
 * COUNTRIES: the platform is a US account and `GET /v1/country_specs/US`
 * reports 120 `supported_transfer_countries`, which covers everywhere the
 * current roster lives except Brazil and Nepal. Do not hardcode that list. It
 * changes, and stripe will refuse an unsupported country at account creation
 * with a message worth showing, which is a better answer than a stale array.
 */

const API = "https://api.stripe.com/v1";

/** small json round trips. a person is waiting on every one of these. */
const TIMEOUT_MS = 20_000;

export function stripeConnectConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Stripe takes form encoding, including for nested params, which is why this
 * exists rather than JSON.stringify. `capabilities[transfers][requested]` is a
 * key, not a path to build.
 */
function form(fields: Record<string, string | number | boolean | undefined>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    body.set(key, String(value));
  }
  return body.toString();
}

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type StripeResult<T> = Ok<T> | Err;

/**
 * One request.
 *
 * A network failure or a timeout comes back prefixed `unknown:`, and that
 * prefix is load bearing: the payout action checks for it and deliberately
 * does NOT release the claim, because a request that never came back cleanly
 * may or may not have moved money. Anything stripe actually answered with is a
 * definite refusal and is safe to release on.
 */
async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: string; idempotencyKey?: string }
): Promise<StripeResult<T>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "stripe is not configured" };

  try {
    const res = await fetch(`${API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // stripe replays the original response for a key it has seen, which is
        // what makes a retry that reaches them twice pay once.
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init.body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const json = (await res.json().catch(() => ({}))) as
      | (T & { error?: { message?: string; code?: string } })
      | { error?: { message?: string; code?: string } };

    if (!res.ok) {
      const detail =
        (json as { error?: { message?: string } }).error?.message ?? `http ${res.status}`;
      return { ok: false, error: String(detail).slice(0, 300) };
    }

    return { ok: true, data: json as T };
  } catch (err) {
    return {
      ok: false,
      error: `unknown: ${err instanceof Error ? err.message : "stripe unreachable"}`,
    };
  }
}

/* ------------------------------------------------------------------ account */

export type StripeAccount = {
  id: string;
  country?: string;
  details_submitted?: boolean;
  payouts_enabled?: boolean;
  capabilities?: Record<string, string>;
  requirements?: { disabled_reason?: string | null; currently_due?: string[] };
};

/**
 * An Express account that can receive money and do nothing else.
 *
 * `service_agreement=recipient` for anyone outside the platform's own country.
 * That is what a cross-border payouts account is: it can be sent money and paid
 * out, and it cannot take payments. Sending the full agreement to a country
 * that only supports recipient status is refused by stripe, and sending
 * recipient where it does not apply is equally wrong, so it keys off the one
 * thing that decides it.
 */
export async function createExpressAccount(input: {
  email: string | null;
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string;
}): Promise<StripeResult<StripeAccount>> {
  const crossBorder = input.country.toUpperCase() !== "US";

  return call<StripeAccount>("/accounts", {
    method: "POST",
    body: form({
      type: "express",
      country: input.country.toUpperCase(),
      email: input.email ?? undefined,
      "capabilities[transfers][requested]": true,
      ...(crossBorder ? { "tos_acceptance[service_agreement]": "recipient" } : {}),
    }),
  });
}

export async function getAccount(accountId: string): Promise<StripeResult<StripeAccount>> {
  return call<StripeAccount>(`/accounts/${encodeURIComponent(accountId)}`, {
    method: "GET",
  });
}

/**
 * The hosted onboarding url. Single use and short lived by design, so it is
 * minted per click and never stored.
 */
export async function createAccountLink(input: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<StripeResult<{ url: string }>> {
  return call<{ url: string }>("/account_links", {
    method: "POST",
    body: form({
      account: input.accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: "account_onboarding",
    }),
  });
}

/** the express dashboard, where they change their bank details later. */
export async function createLoginLink(
  accountId: string
): Promise<StripeResult<{ url: string }>> {
  return call<{ url: string }>(
    `/accounts/${encodeURIComponent(accountId)}/login_links`,
    { method: "POST" }
  );
}

/* ----------------------------------------------------------------- transfer */

export type Transfer = { id: string };

/**
 * Money leaves here.
 *
 * `idempotencyKey` is our own batch uuid, exactly as `senderBatchId` is on the
 * PayPal side, which is why the caller must claim the batch in the database
 * BEFORE calling this and never after. Stripe replays the original transfer for
 * a repeated key rather than making a second one.
 *
 * This moves platform balance to the connected account. Stripe pays that on to
 * their bank on its own schedule, so "sent" here means the editor's stripe
 * balance, not their bank, and the copy says so.
 */
export async function sendTransfer(input: {
  amountCents: number;
  destination: string;
  idempotencyKey: string;
  description: string;
}): Promise<StripeResult<Transfer>> {
  if (input.amountCents <= 0) return { ok: false, error: "nothing to send" };

  return call<Transfer>("/transfers", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: form({
      amount: Math.round(input.amountCents),
      currency: "usd",
      destination: input.destination,
      description: input.description.slice(0, 200),
      "metadata[batch_id]": input.idempotencyKey,
    }),
  });
}
