// Cloudflare Email Worker. The catch-all in front of the account email domain.
//
// Cloudflare Email Routing hands every message for the domain to this worker.
// It parses the MIME, flattens it, and POSTs it to the app's inbound webhook,
// which matches the recipient to a generated address and pulls the code out.
//
// Two secrets, both set with `wrangler secret put` and never in this file:
//   INBOUND_WEBHOOK_URL   https://www.ugcflows.com/api/inbound-email
//   INBOUND_EMAIL_SECRET  the same value as the app's env var
//
// This is the cheapest half of the whole feature: routing is free, the worker
// is free at this volume, and no mailbox is ever created for any address.

import PostalMime from "postal-mime";

export default {
  async email(message, env, ctx) {
    let parsed = { subject: "", text: "", html: "" };
    try {
      parsed = await PostalMime.parse(message.raw);
    } catch {
      // headers still carry the subject, and a code-less row in front of a
      // person beats a dropped email every time.
      parsed.subject = message.headers.get("subject") || "";
    }

    const payload = {
      to: message.to,
      from: message.from,
      subject: parsed.subject || message.headers.get("subject") || "",
      text: parsed.text || "",
      html: parsed.html || "",
      // the app's idempotency key. every provider redelivers, including this one
      messageId: message.headers.get("message-id") || "",
    };

    // The bearer secret must never cross plaintext, so a misconfigured http url
    // fails loudly here rather than leaking it on the first email.
    if (!env.INBOUND_WEBHOOK_URL || !env.INBOUND_WEBHOOK_URL.startsWith("https://")) {
      throw new Error("INBOUND_WEBHOOK_URL must be set to an https:// url");
    }

    ctx.waitUntil(
      fetch(env.INBOUND_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.INBOUND_EMAIL_SECRET}`,
        },
        body: JSON.stringify(payload),
      })
    );
  },
};
