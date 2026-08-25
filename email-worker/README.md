# Inbound email worker

The catch-all that feeds `/tools/account-emails`. Cloudflare Email Routing to
the app's `/api/inbound-email` webhook, so a signup code lands in the dashboard
a second or two after the platform sends it.

Nothing here creates a mailbox. Every generated address is a row in
`public.account_emails`, and the catch-all accepts anything at the domain, which
is why forty addresses cost the same as one.

## Setup, once

### 1. Pick the domain

Use a **subdomain**, and set it on the app:

```
ACCOUNT_EMAIL_DOMAIN=accounts.ugcflows.com
```

Pointing the root domain's MX at a catch-all takes over every existing address
on it, including whatever you read mail on. A subdomain has no mail to break,
and no signup form has ever cared about the extra dot.

### 2. App env vars (Vercel)

```
INBOUND_EMAIL_SECRET=<a long random string>
ACCOUNT_EMAIL_DOMAIN=accounts.ugcflows.com
```

With the secret unset the webhook answers 401 to everything. That is deliberate:
an open inbound endpoint lets a stranger post themselves a code.

### 3. Cloudflare Email Routing

1. Cloudflare dashboard, the zone, **Email → Email Routing**, enable it. This
   points the MX at Cloudflare.
2. Add explicit forward rules for any address that already works **before**
   turning the catch-all on.
3. **Catch-all → Send to a Worker →** this worker.

### 4. Deploy

```bash
cd email-worker
npm install
npx wrangler secret put INBOUND_WEBHOOK_URL   # https://www.ugcflows.com/api/inbound-email
npx wrangler secret put INBOUND_EMAIL_SECRET  # same value as the app env var
npm run deploy
```

## Test

Generate an address in `/tools/account-emails`, send it anything, and watch the
card appear. `npm run tail` shows the worker's side.

Or without the worker at all:

```bash
curl -X POST https://www.ugcflows.com/api/inbound-email \
  -H "authorization: Bearer $INBOUND_EMAIL_SECRET" \
  -H "content-type: application/json" \
  -d '{"to":"<a generated address>","from":"TikTok <no-reply@tiktok.com>",
       "subject":"010571 is your verification code","text":"010571 is your verification code",
       "messageId":"test-1"}'
```

`{"matched":true,"hasCode":true}` means the whole chain works and only the MX
half is left.

## Notes

- The worker parses MIME with `postal-mime` and posts
  `{ to, from, subject, text, html, messageId }`. Matching, extraction and
  storage are all the app's job, so swapping this for another provider is a new
  entry in `lib/inbound-email/providers.ts` and nothing else.
- Unmatched recipients are ignored with a 200. Catch-all mail is mostly noise
  and a 4xx would make the provider retry it.
- Redelivery is a no-op: `(provider, provider_message_id)` is a unique index.
