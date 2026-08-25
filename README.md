# creator empire

the creator empire app. one workspace, its own deploy, its own domain, its own supabase project (`xgiifxrxmtyklwglpewb`).

what it is: for a student, the dashboard, deals, the scheduler (autoposting) and the editing desk. for whoever runs the programme, the students with what each one costs, and invites, roles and removal. nothing else: no tools shelf, no branding, no billing. a person gets in by holding a seat on the creator empire org, or by being a founder of the platform.

## run it

```
npm install
cp .env.example .env.local   # fill it in, see below
npm run dev
```

open http://localhost:3000. sign in with google. the account has to hold a seat on the org (or be on `admin_emails`).

## deploy

1. push this folder to its own github repo.
2. vercel: new project from that repo. framework next.js, defaults.
3. environment variables: everything in `.env.example` that you actually use. the three that matter:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`: from the creator empire supabase project.
   - `NEXT_PUBLIC_CE_ORG_ID`: the org's id. `select id from orgs where slug = 'creator-empire'`.
   - `NEXT_PUBLIC_SITE_URL`: the address this deploy lives at (https://app.creatorempire.com or the vercel url).
4. supabase → authentication → url configuration → redirect urls: add `https://<your domain>/**` (and `http://localhost:3000/**` for dev). without it google sign in bounces to the ugc flows site url.
5. deploy.

## what is shared with ugc flows

the database. deals, videos, stats, payouts, autoposting, editing, credits, notifications, the org and its members: all the same rows, scoped by row level security exactly as they are there. a student who logs in here sees their creator empire deals; a founder sees everything from /founder.

the cron that keeps view counts fresh runs on the ugc flows deploy, once, for both. this `vercel.json` has no crons on purpose: two deploys draining the same queue spend the api budget twice.

## what is different

- `lib/org.ts` `CE_ORG_ID`: the one workspace. `lib/workspace.ts` is always this org, no switcher, no cookie, no host lookup.
- `lib/access.ts` `isEntitled`: founder, or a seat on this org. a subscription buys nothing here.
- `app/page.tsx` redirects to /dashboard. the marketing pages, the low ticket kit and the mentorship pages are gone.
- the palette in `app/globals.css` is navy, rail included. the org row's colours are not read.
- the rail is a fixed list (`components/dash/side-nav.tsx`). the routes behind everything not on it are deleted.

## adding people

owner or admin of the org: /agency/people, invite by email, pick a role (student = creator, or admin). the invite link is on this deploy's address. the owner changes a role from the same page. /agency lists every student with deals, views, earned, owed and what their scraping and ai cost in the last 30 days.
