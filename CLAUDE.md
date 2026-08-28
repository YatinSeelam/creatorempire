@AGENTS.md

# creator empire

**this folder is the live repo again as of 2026-08-28.** it is its own git repo (`github.com/creatorempire11-droid/creatorempire`), its own vercel project and its own deploy. edit HERE. the "archive, edit in the ugc flows repo" note that stood here on 2026-08-27 was written when the plan was to serve this tree from inside ugc flows at `/creatorempire`; that copy (`app/creatorempire/**`, `lib/ce/**`, `components/ce/**` over there) still exists and is now the stale one. two trees of the same product is a real hazard, so before changing a screen, check which of the two the deploy you care about is built from.

the creator empire app: a standalone deploy of the ugc flows dashboard for ONE workspace. next 16 app router + react 19 + tailwind 4 + supabase. package name: `creatorempire`.

**separate repo, separate deploy, separate database.** the supabase project is `xgiifxrxmtyklwglpewb`, creator empire's own, with its own `orgs` row (`slug = 'creator-empire'`, id `aa0129dd-…`, which is `NEXT_PUBLIC_CE_ORG_ID`). ugc flows' project is `qtcwdvaoxrfojzaktwyg` and creator empire does not use it.

**sharing an auth project is what stopped this being separate, and it is not a preference.** a supabase project has ONE Site URL, and an oauth `redirect_to` that is not on its allow list is silently replaced with it. `qtcwdvaoxrfojzaktwyg`'s Site URL is `https://www.ugcflows.com`, so signing in to creator empire against that project landed on `ugcflows.com/login` reading "that sign-in did not finish in this browser". nothing in this repo redirected there — every `ugcflows` string under `app/`, `lib/` and `components/` is a comment. it was supabase's own fallback. `xgiifxrxmtyklwglpewb`'s Site URL is `https://creatorempire.vercel.app`, so it cannot happen.

to read a project's Site URL without the dashboard: `GET /auth/v1/callback?error=access_denied` and look at the `Location` header. that is the one call that answers "where does a half-finished sign-in end up".

the two projects have DIFFERENT `orgs` rows, so `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_CE_ORG_ID` move together, always. `7927501b-…` exists only in qtcw and `aa0129dd-…` only here; a CE_ORG_ID naming an org its database has never heard of means nobody holds a seat and the gate shuts, which is the safe failure and an confusing one to debug. the publishable key and the secret key are per project too: mixing a url from one with a key from the other is what "Invalid API key" out of the cron means.

`.mcp.json` still points at `qtcwdvaoxrfojzaktwyg`, which is now the WRONG project for this app. migrations were written in the ugc flows repo while the database was shared; a schema change for creator empire now has to be applied to `xgiifxrxmtyklwglpewb`.

this folder was cut from the ugc flows repo on 2026-08-25. the code is the same product with the marketing, the self serve plan and the agency builder removed, and the whole app pinned to one org.

## how i want you to work

- shortest useful answer, 3 lines max. lead with the answer, cut the reasoning. no preamble, no recap.
- make the edit and stop. if something might break, flag it in one line.
- copy you write for the product: lowercase, casual, direct, **no em dashes anywhere**, including ui strings, mock data and tab titles.
- after any real change, append to `work_log.txt` at this folder's root, newest on top.

## the one rule

`NEXT_PUBLIC_CE_ORG_ID` (`CE_ORG_ID` in `lib/org.ts`) is the workspace. `lib/workspace.ts` resolves every request to it: an owner or admin seat is the programme side (/agency students with cost per student, /agency/people invites, roles, removal), a creator seat is the student side scoped to the org's books, a founder of the platform gets /founder. `lib/access.ts` `isEntitled` is founder or a seat on that org, nothing else. there is no workspace switcher, no tenant host lookup, no `ugcf_ws` cookie behaviour worth relying on.

## what is on the rail, and nothing else

`components/dash/side-nav.tsx` is a fixed list. student: dashboard, deals, scheduler (`/tools/autoposting`), editing. owner/admin: students, invites & roles. founder row for founders, settings at the foot. no tools shelf, no branding, no modules, no flow, no sections toggles, no billing tab. the logo is `public/logo.png` (the crown) drawn as a rounded square; `app/icon.png` is the favicon from the same file. the rail is navy from `app/globals.css`, active row is white on navy, and the layout no longer reads the org's colours at all.

the routes for everything removed are deleted, not hidden: tools other than autoposting, campaigns, modules, portfolio, flow, agency branding and modules, and the api routes behind them. `lib/` still carries their code so a copy from ugc flows lands cleanly; delete from `lib/` only when a build says nothing imports it.

roles: `setMemberRole` in `app/(dash)/agency/actions.ts`, behind the `org_members_owner_update` policy (owner only, never the owner row, column scoped to `role`). that migration lives in the ugc flows repo like every other one.

## where it deploys, and the two values that decide the shape

vercel project `creatorempire`, production `https://creatorempire.vercel.app`, built from the `yatin` remote. env lives on the vercel project, not in the repo.

**`NEXT_PUBLIC_SITE_URL` decides whether this app has a path prefix.** `lib/base-path.ts` reads the PATH off it, so a bare origin (what production is now) means `BASE_PATH` is `""` and the app serves at the root of its own host; `https://www.ugcflows.com/creatorempire` would mean the prefixed build behind the ugc flows proxy. it is a BUILD time value, inlined into the client bundles, so changing it is a rebuild rather than a restart.

**`vercel.json`'s cron path has to agree with it.** it is a literal string vercel calls and nothing derives it from `BASE_PATH`, so a prefix in one and not the other is a cron that 404s every hour with no error anywhere and a sync queue nobody drains. it is `/api/cron/refresh` while SITE_URL is a bare origin. no comments in that file: the schema rejects unknown keys inside a cron entry.

**a production env change needs a fresh BUILD, not a redeploy.** `vercel redeploy` reuses the artifact, and every `NEXT_PUBLIC_*` is already baked into it, so the old values survive. `vercel --prod` or a push.

the fastest way to check what production is actually pointed at, with no credentials: fetch `/login`, pull the `/_next/static/*.js` chunks and grep them for the supabase ref. that is how the dead-project deploy was caught.

## what is switched off, and how it says so

three things are hidden rather than deleted, because deleting them means a copy from ugc flows stops landing cleanly.

**editing is off and announced.** `EDITING_ENABLED` in `lib/editing.ts` is `false`, so `app/(dash)/editing/layout.tsx` serves `app/(dash)/editing/soon.tsx` in place of its children and the rail's Editing row wears a `soon` chip. it used to `notFound()`, which was the app contradicting itself: a row the product draws must not lead to "this does not exist". a founder still gets the real thing, because they are the one rehearsing the launch. `soon.tsx` is deliberately not a route file, so flipping the const deletes every path to it. `EDITOR_MARKET_ENABLED` and `EDITOR_HIRING_ENABLED` were already false and still 404 the whole `/editors` tree.

**the api keys panel is gone from /settings.** the keys are the deploy's, in its env. `apiKey()` in `lib/api-keys.ts` still reads a stored workspace key first and `org_api_credentials` is empty, so the whole per-programme path is intact and unused. what came off is only the form: a panel of empty password fields reads as work the product is waiting on somebody for, and it is not. to bring it back, render `ApiKeysForm` behind an owner/admin seat and read `provider, hint` off that table.

**the manual refresh does not block the browser.** `refreshEverything` in `app/(dash)/deals/actions.ts` claims the allowance, reads the account list, and hands the sweep to `after()` — so the reply lands immediately saying "about five minutes", closing the tab cannot kill the scrape, and the "your numbers are fresh" email became the way anybody learns it finished rather than a nicety. the three checks that hand the allowance straight back (no session, no accounts, unreadable count) still run before the reply, but a sweep that reaches a provider and fails is refunded inside the callback, so that refund shows as a higher count on the next page load rather than in the sentence. `RefreshAll` polls `router.refresh()` every 45s for six minutes to fill the numbers in for whoever stayed.

## shared database, own cron, own path

the schema is ugc flows'. a schema change is written in the ugc flows repo (`../supabase/migrations/`) and applied through THAT repo's mcp; `supabase/migrations/` here is a read-only copy of the history for reference, and `supabase/bootstrap/` is what stood up the old project. never apply from here.

hosting: `NEXT_PUBLIC_SITE_URL=https://www.ugcflows.com/creatorempire`. `lib/base-path.ts` reads the path off it and `next.config.ts` sets `basePath` from that, so the same code runs standalone on localhost with no prefix. the ugc flows proxy asks `zone_origin('creator-empire')` for this deploy's vercel origin (`orgs.app_origin`, set on ugc flows' /founder/mentorships) and rewrites `ugcflows.com/creatorempire/*` here. next/link, router.push, redirect() and revalidatePath are base-path aware; hand-built urls (route handler redirects, `redirectTo`, plain `<img>`/`<a>`/`<form action>`, client fetch) are not, and are prefixed by hand. `vercel.json` runs `/creatorempire/api/cron/refresh` hourly, because nobody else drains this org's sync queue; `CRON_SECRET` must be set or the route 503s.

the session is shared with ugc flows: same supabase url + publishable key as ugc flows production (cookie names derive from the api hostname), cookie domain `.ugcflows.com` from SITE_URL regardless of the host header (`lib/supabase/cookie-domain.ts`), so one google sign-in covers the mother platform and every mentorship.

api keys: the programme pastes its own scrapecreators / upload-post / apify / rapidapi / youtube keys on /settings (owner and admin). `lib/api-keys.ts` resolves workspace key first, env second, always passing `CE_ORG_ID` as `p_org`, because a founder holds seats on many mentorships and "the caller's first seat" is the wrong org.

## sign in

google only. `components/auth-form.tsx` is one button, `/sign-up` redirects to `/login`, `/auth/callback` lands on `/dashboard`. a person gets in by holding a seat on `NEXT_PUBLIC_CE_ORG_ID` or by being on `admin_emails`; anyone else lands on `/account`, which says "not on the roster" and offers sign out. supabase side: google provider on, the google cloud client is ugc flows' (supabase project `qtcwdvaoxrfojzaktwyg`), and `https://www.ugcflows.com/creatorempire/auth/callback` is on that project's redirect allow list.

## keeping it in step with ugc flows

this is a fork by copy. when a screen changes in ugc flows (`app/(dash)/**`, `components/dash/**`, `lib/**`), copy the file over. edited here and worth diffing before a copy: `lib/workspace.ts`, `lib/access.ts`, `lib/org.ts` (`CE_ORG_ID`), `lib/org-server.ts` (per member `micros`), `lib/content.ts`, `app/globals.css`, `app/page.tsx`, `app/(dash)/layout.tsx`, `components/dash/side-nav.tsx`, `components/auth-shell.tsx`, `app/(dash)/settings/page.tsx`, and the three files under `app/(dash)/agency/`. everything else is a straight copy.

for the product's own model (deals, bonus rules, the sync, autoposting, editing, the bell) read the ugc flows repo's CLAUDE.md; it is the same code.
