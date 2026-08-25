import crypto from "node:crypto";

/**
 * Inbound email, normalised.
 *
 * The tool needs one thing from a mail provider: every message sent to our
 * domain, posted somewhere we can read it. Every vendor does that with a
 * different envelope, and picking one at the schema level would mean a
 * migration the day their pricing changes. So the route knows this shape only,
 * and a provider is a small object that recognises its own requests, proves
 * they are real, and flattens them into it.
 *
 * Two are wired: the cloudflare email worker in email-worker/, which is free
 * and is what runs today, and resend, which signs with svix. Adding a third
 * (postmark, mailgun, sendgrid) is one more entry in `providers` and nothing
 * else in the app changes.
 */

export type InboundMessage = {
  /** which provider handled it, stored on the row so a bad parse is traceable */
  provider: string;
  /** the provider's own id for this message. the whole idempotency story */
  messageId: string | null;
  /** every address it was addressed to. catch-all mail is full of extra ones */
  recipients: string[];
  from: string;
  subject: string;
  text: string;
  html: string;
};

export type InboundEmailProvider = {
  id: string;
  /** cheap look at the headers: is this request ours to handle */
  claims(req: Request): boolean;
  /** prove it. a provider that cannot prove itself never parses */
  verify(req: Request, rawBody: string): boolean;
  parse(rawBody: string): InboundMessage | null;
};

export type InboundResult =
  | { ok: true; message: InboundMessage }
  | { ok: false; status: number; error: string };

/** Constant time compare that does not leak length through an early return. */
function sameSecret(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Flatten whatever a provider put in `to` into a list of bare addresses. */
function toRecipients(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const parts = Array.isArray(value) ? value : [value];
    for (const part of parts) {
      const raw =
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "address" in part
            ? str((part as { address?: unknown }).address)
            : "";
      for (const piece of raw.split(",")) {
        const angled = piece.match(/<([^>]+)>/);
        const addr = (angled ? angled[1] : piece).trim().toLowerCase();
        if (addr.includes("@")) out.push(addr);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * The shared secret provider. Anything that can POST json and set a header.
 *
 * This is what email-worker/ uses, and the key names are loose on purpose so
 * the same route also accepts postmark's json (`TextBody`, `FromFull`) behind a
 * proxy that adds the header. The secret is the entire authentication: without
 * it set, the route refuses every request rather than accepting unsigned mail.
 */
const sharedSecret: InboundEmailProvider = {
  id: "shared-secret",

  claims(req) {
    return Boolean(req.headers.get("authorization") || req.headers.get("x-webhook-secret"));
  },

  verify(req) {
    const secret = process.env.INBOUND_EMAIL_SECRET;
    if (!secret) return false;
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ") && sameSecret(auth.slice(7), secret)) return true;
    return sameSecret(req.headers.get("x-webhook-secret"), secret);
  },

  parse(rawBody) {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }

    return {
      provider: "shared-secret",
      messageId:
        str(body.messageId) || str(body.MessageID) || str(body["message-id"]) || null,
      recipients: toRecipients(body.to, body.To, body.recipient, body.OriginalRecipient),
      from: str(body.from) || str(body.From),
      subject: str(body.subject) || str(body.Subject),
      text: str(body.text) || str(body.TextBody),
      html: str(body.html) || str(body.HtmlBody),
    };
  },
};

/**
 * Resend inbound. Signed with svix, which is the only proof available because
 * resend cannot be told to send a custom header.
 *
 * Same construction as the stripe webhook next door: hmac over
 * `id.timestamp.body`, with a timestamp window so a captured request cannot be
 * replayed a week later.
 */
const resend: InboundEmailProvider = {
  id: "resend",

  claims(req) {
    return Boolean(req.headers.get("svix-id") && req.headers.get("svix-signature"));
  },

  verify(req, rawBody) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return false;

    const id = req.headers.get("svix-id");
    const timestamp = req.headers.get("svix-timestamp");
    const signatures = req.headers.get("svix-signature");
    if (!id || !timestamp || !signatures) return false;

    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 300) return false;

    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto
      .createHmac("sha256", key)
      .update(`${id}.${timestamp}.${rawBody}`)
      .digest("base64");

    // the header is a space separated list of "v1,<sig>" pairs
    return signatures
      .split(" ")
      .some((part) => sameSecret(part.split(",")[1], expected));
  },

  parse(rawBody) {
    let body: { type?: string; data?: Record<string, unknown> };
    try {
      body = JSON.parse(rawBody) as { type?: string; data?: Record<string, unknown> };
    } catch {
      return null;
    }
    const data = body.data ?? {};

    return {
      provider: "resend",
      messageId: str(data.email_id) || str(data.id) || null,
      recipients: toRecipients(data.to),
      from: str(data.from),
      subject: str(data.subject),
      text: str(data.text),
      html: str(data.html),
    };
  },
};

export const providers: readonly InboundEmailProvider[] = [resend, sharedSecret];

/**
 * Read one inbound request. Resolves the provider, verifies it, and hands back
 * a normalised message or the status the route should answer with.
 *
 * `resend` is tried first because its headers are specific; the shared secret
 * one claims anything carrying an Authorization header and would otherwise
 * swallow a signed request that happened to have one.
 */
export function readInbound(req: Request, rawBody: string): InboundResult {
  const provider = providers.find((p) => p.claims(req));
  if (!provider) {
    return { ok: false, status: 401, error: "unrecognised sender" };
  }
  if (!provider.verify(req, rawBody)) {
    return { ok: false, status: 401, error: "bad signature" };
  }

  const message = provider.parse(rawBody);
  if (!message) {
    return { ok: false, status: 400, error: "unreadable body" };
  }
  return { ok: true, message };
}

/** Whether any provider could authenticate at all, for the ui's setup banner. */
export function inboundConfigured(): boolean {
  return Boolean(process.env.INBOUND_EMAIL_SECRET || process.env.RESEND_WEBHOOK_SECRET);
}
