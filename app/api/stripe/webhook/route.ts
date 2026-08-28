import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Stripe -> site. The only thing that may write `public.subscriptions`.
 *
 * Deliberately has no stripe SDK behind it. The one thing the SDK does that
 * matters here is verify the signature, and that is thirty lines of node
 * crypto — not worth a dependency, a version to keep current, or the bundle.
 *
 * SETUP, both values from the stripe dashboard:
 *   STRIPE_WEBHOOK_SECRET   whsec_... shown when you add the endpoint
 *   SUPABASE_SECRET_KEY     the project's secret (service_role) key
 * Point the endpoint at https://<domain>/api/stripe/webhook and subscribe it
 * to checkout.session.completed, invoice.paid, invoice.payment_failed,
 * customer.subscription.updated and customer.subscription.deleted.
 *
 * Until both env vars are set this route answers 500 and nothing is ever
 * marked paid. That is the safe direction to fail in: an account that has
 * paid and shows as unpaid is a support email, the other way round is a
 * stranger inside the product.
 */
export const runtime = "nodejs";
// billing state must never be served from a cache
export const dynamic = "force-dynamic";

/** how far a signature's timestamp may be from now. stripe's own default. */
const TOLERANCE_SECONDS = 300;

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabase = createServiceClient();

  if (!secret || !supabase) {
    console.error("[stripe] webhook is not configured");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  // the RAW body, byte for byte. parsing it first and re-serialising changes
  // key order and whitespace, and the signature is over the exact bytes.
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  // one endpoint, one secret. There was a second one on the same url for
  // stripe Connect, verified with STRIPE_CONNECT_WEBHOOK_SECRET, which existed
  // only to learn that an editor's payout account had gone live. Editing is
  // gone from this deploy and so is that half: the subscription events below
  // are the whole of what this route is for.
  const signed = verify(payload, signature, secret);

  if (!signed) {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  try {
    await handle(event, supabase);
  } catch (err) {
    // 500 makes stripe retry. anything we throw on is worth retrying.
    console.error("[stripe] handler failed", event.type, err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  // 200 on an event we ignore, or stripe retries it for three days
  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

type Client = NonNullable<ReturnType<typeof createServiceClient>>;

async function handle(event: StripeEvent, supabase: Client) {
  const object = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      // job credits are gone from this deploy: nothing is charged for an edit
      // job any more, so nothing here can create a `job_credits` session. an
      // old one still in stripe's retry window is dropped rather than granted.
      const meta = object.metadata as Record<string, unknown> | null | undefined;
      if (str(meta?.kind) === "job_credits") return;

      // the $14.99 starter kit, a one-time payment, not the subscription
      if (str(meta?.kind) === "starter_kit") {
        await grantStarterKit(supabase, object);
        return;
      }

      const userId = await resolveUser(supabase, {
        // the account page puts the supabase user id here before it sends
        // anyone to checkout, so this is the reliable path
        clientReferenceId: str(object.client_reference_id),
        email:
          str((object.customer_details as Record<string, unknown>)?.email) ??
          str(object.customer_email),
        customerId: str(object.customer),
      });
      if (!userId) return;

      await write(supabase, userId, {
        status: "active",
        paid_at: new Date().toISOString(),
        stripe_customer_id: str(object.customer),
        stripe_subscription_id: str(object.subscription),
        last_event_id: event.id,
      });
      return;
    }

    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const userId = await resolveUser(supabase, {
        email: str(object.customer_email),
        customerId: str(object.customer),
      });
      if (!userId) return;

      await write(supabase, userId, {
        status: "active",
        // only set on the first payment. `paid_at` is "founding member since",
        // not "last charged", so a renewal must not move it.
        paid_at: null,
        stripe_customer_id: str(object.customer),
        current_period_end: periodEnd(object),
        last_event_id: event.id,
      });

      return;
    }

    case "invoice.payment_failed": {
      const userId = await resolveUser(supabase, {
        email: str(object.customer_email),
        customerId: str(object.customer),
      });
      if (!userId) return;

      await write(supabase, userId, {
        status: "past_due",
        paid_at: null,
        last_event_id: event.id,
      });
      return;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const userId = await resolveUser(supabase, {
        customerId: str(object.customer),
      });
      if (!userId) return;

      const status = mapStatus(str(object.status), event.type);

      await write(supabase, userId, {
        status,
        paid_at: null,
        stripe_subscription_id: str(object.id),
        current_period_end: periodEnd(object),
        last_event_id: event.id,
      });

      return;
    }


    default:
      // everything else is somebody else's problem
      return;
  }
}

/**
 * The starter kit landing. The only writer of `kit_entitlements`. The unique
 * columns on user_id and stripe_session_id are the whole idempotency story: a
 * retried event, or an owner buying twice, hits the constraint and grants
 * nothing new.
 */
async function grantStarterKit(
  supabase: Client,
  object: Record<string, unknown>
) {
  if (str(object.payment_status) !== "paid") return;

  const meta = (object.metadata ?? {}) as Record<string, unknown>;
  const email =
    str((object.customer_details as Record<string, unknown>)?.email) ??
    str(object.customer_email);

  // our own server wrote the user id into the metadata when it built the
  // session, so that is the reliable path; resolveUser is the fallback
  const fromMeta = str(meta.user_id);
  const userId =
    fromMeta && isUuid(fromMeta)
      ? fromMeta
      : await resolveUser(supabase, {
          clientReferenceId: str(object.client_reference_id),
          email,
          customerId: str(object.customer),
        });
  if (!userId) return;

  const { error } = await supabase.from("kit_entitlements").insert({
    user_id: userId,
    email: email ?? null,
    stripe_session_id: str(object.id),
  });

  // 23505 is the replay: already granted. anything else throws so stripe
  // retries a grant that genuinely failed.
  if (error && error.code !== "23505") {
    throw new Error(`kit grant failed: ${error.message}`);
  }
}

/**
 * Which account this event belongs to.
 *
 * Three ways, in descending order of how much they can be trusted: the id we
 * ourselves attached to the checkout session, the stripe customer id we have
 * seen before, and finally the email. Email is last because two people can
 * type the same one and only the id is ours.
 */
async function resolveUser(
  supabase: Client,
  from: { clientReferenceId?: string; email?: string; customerId?: string }
): Promise<string | null> {
  if (from.clientReferenceId && isUuid(from.clientReferenceId)) {
    return from.clientReferenceId;
  }

  if (from.customerId) {
    const { data } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", from.customerId)
      .maybeSingle();
    if (data?.user_id) return data.user_id as string;
  }

  if (from.email) {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", from.email)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  // a payment we cannot attach to an account. it is real money, so it is worth
  // a loud log rather than a silent drop — someone paid on the raw payment
  // link without ever making an account.
  console.error("[stripe] unmatched payment", from);
  return null;
}

/** Upsert, with `paid_at` written once and never overwritten. */
async function write(
  supabase: Client,
  userId: string,
  patch: {
    status: string;
    paid_at: string | null;
    stripe_customer_id?: string;
    stripe_subscription_id?: string;
    current_period_end?: string | null;
    last_event_id: string;
  }
) {
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("paid_at")
    .eq("user_id", userId)
    .maybeSingle();

  const row: Record<string, unknown> = {
    user_id: userId,
    status: patch.status,
    last_event_id: patch.last_event_id,
    updated_at: new Date().toISOString(),
  };

  // first payment wins. a renewal passes null and an existing value stays.
  const paidAt = existing?.paid_at ?? patch.paid_at;
  if (paidAt) row.paid_at = paidAt;

  if (patch.stripe_customer_id) {
    row.stripe_customer_id = patch.stripe_customer_id;
  }
  if (patch.stripe_subscription_id) {
    row.stripe_subscription_id = patch.stripe_subscription_id;
  }
  if (patch.current_period_end) {
    row.current_period_end = patch.current_period_end;
  }

  const { error } = await supabase
    .from("subscriptions")
    .upsert(row, { onConflict: "user_id" });

  if (error) throw error;
}

/**
 * Constant-time signature check over `${timestamp}.${payload}`.
 *
 * The header carries one timestamp and one or more v1 signatures — more than
 * one while a secret is being rotated — so any match counts.
 */
function verify(payload: string, header: string, secret: string) {
  const parts = header.split(",").map((p) => p.split("="));
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);

  if (!timestamp || signatures.length === 0) return false;

  // a replayed request from days ago is not a valid one, even though its
  // signature still checks out
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest();

  return signatures.some((sig) => {
    let given: Buffer;
    try {
      given = Buffer.from(sig, "hex");
    } catch {
      return false;
    }
    // timingSafeEqual throws on a length mismatch rather than returning false
    return (
      given.length === expected.length && crypto.timingSafeEqual(given, expected)
    );
  });
}

/** Stripe moved `current_period_end` onto the subscription item. Read both,
 *  because which one you get depends on the account's API version. */
function periodEnd(object: Record<string, unknown>): string | null {
  const items = (object.items as { data?: Record<string, unknown>[] })?.data;
  const seconds =
    num(object.current_period_end) ??
    num(object.period_end) ??
    num(items?.[0]?.current_period_end);

  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

/** Stripe's subscription statuses, collapsed to the four we store. */
function mapStatus(status: string | undefined, eventType: string) {
  if (eventType === "customer.subscription.deleted") return "canceled";
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "inactive";
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
