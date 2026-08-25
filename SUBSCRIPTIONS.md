# what creator empire needs paid for

one list, one owner per line. everything else in the codebase is optional or already covered.

## must have

| service | what it runs | plan | sign up | env var |
|---|---|---|---|---|
| vercel | hosting the app | hobby (free) is fine to start, pro ($20/mo) once students are on it | vercel.com | none, it is the deploy itself |
| supabase | database + login | shared with ugc flows, already paid | supabase.com | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` |
| upload-post | the scheduler (autoposting to tiktok, instagram, youtube, facebook) | starts around $20/mo, price goes up with connected accounts | upload-post.com | `UPLOAD_POST_API_KEY` |
| rapidapi | tiktok + instagram view tracking | subscribe the same rapidapi account to two apis: `tiktok-api23` and `instagram-api-fast-reliable-data-scraper`. flat monthly, roughly $10 to $30 each depending on tier | rapidapi.com | `RAPIDAPI_KEY` (one key covers both) |
| google cloud | youtube view tracking | free. enable "YouTube Data API v3" and make an api key. 10,000 units a day covers ~3,000 accounts | console.cloud.google.com | `YOUTUBE_API_KEY` |

## should have

| service | what it runs | plan | sign up | env var |
|---|---|---|---|---|
| scrapecreators | facebook reels tracking, and a fallback for tiktok / instagram / youtube if rapidapi is missing | pay as you go credits, ~$0.002 to $0.003 per credit. a student with 10 accounts burns pennies a month | scrapecreators.com | `SCRAPECREATORS_API_KEY` |
| resend | invite emails, notification emails | free tier (3,000 emails/mo) is enough | resend.com | `RESEND_API_KEY`, `EMAIL_FROM` |

## only if editors get paid through the app

| service | what it runs | plan | sign up | env var |
|---|---|---|---|---|
| stripe | editor payouts (connect) and buying editing credits | no monthly plan, transaction fees only | stripe.com | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` |
| paypal | editor payouts where stripe connect does not reach | no monthly plan, fees only | developer.paypal.com | `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_ENV` |

## not needed

flow / anthropic, deepgram, apify, google drive keys, cloudflare email worker, vercel domains token. all removed from this app.

## other env vars (no subscription)

- `NEXT_PUBLIC_CE_ORG_ID` = the workspace id
- `NEXT_PUBLIC_SITE_URL` = the address the app lives at
- `CRON_SECRET` = not needed here, the ugc flows deploy runs the sync for both

## rough monthly total

- minimum to work: $0 (vercel hobby) + rapidapi ~$20 to $60 + upload-post ~$20 = **~$40 to $80 / mo**
- comfortable: add vercel pro $20 + scrapecreators ~$5 = **~$65 to $105 / mo**

## uploads

no google drive api anywhere. files upload straight to supabase storage (`lib/autopost/upload.ts`, `lib/editing-files.ts`). a google drive share link can be pasted as a plain url, that is a fetch of a public file, not an api.
