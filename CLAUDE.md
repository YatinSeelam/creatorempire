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

vercel project `creatorempire`, production **`https://www.trycreatorempire.com`** (live 2026-08-28, dns at porkbun pointed at vercel, apex 308s to `www`), built from the `yatin` remote. env lives on the vercel project, not in the repo. `creatorempire.vercel.app` still answers and is a fine place to check a build; it is not what goes in a canonical tag, an og:url or an email. `SITE_URL`'s production fallback in `lib/site-url.ts` is the real domain now, so a deploy that loses the env var still writes canonicals at the host that serves the site.

**`NEXT_PUBLIC_SITE_URL` decides whether this app has a path prefix, and what its cookies are scoped to.** `lib/base-path.ts` reads the PATH off it, so a bare origin (`https://www.trycreatorempire.com/`, trailing slash and all, which reduces to `""`) means the app serves at the root of its own host; `https://www.ugcflows.com/creatorempire` would mean the prefixed build behind the ugc flows proxy, which is not how this is served any more. `lib/supabase/cookie-domain.ts` reads the HOST off the same value and widens the auth cookie to `.trycreatorempire.com`. it is a BUILD time value, inlined into the client bundles, so changing it is a rebuild rather than a restart — and a local `.env` carrying the production origin scopes localhost's cookie to a domain the browser is not on, which silently kills a local sign-in. use `http://localhost:3000` for dev.

**`vercel.json`'s cron path has to agree with it.** it is a literal string vercel calls and nothing derives it from `BASE_PATH`, so a prefix in one and not the other is a cron that 404s every hour with no error anywhere and a sync queue nobody drains. it is `/api/cron/refresh` while SITE_URL is a bare origin. no comments in that file: the schema rejects unknown keys inside a cron entry.

**a production env change needs a fresh BUILD, not a redeploy.** `vercel redeploy` reuses the artifact, and every `NEXT_PUBLIC_*` is already baked into it, so the old values survive. `vercel --prod` or a push.

the fastest way to check what production is actually pointed at, with no credentials: fetch `/login`, pull the `/_next/static/*.js` chunks and grep them for the supabase ref. that is how the dead-project deploy was caught.

## what is switched off, and how it says so

**editing is DELETED, 2026-08-28, not switched off.** it spent three days behind `EDITING_ENABLED` and the flag is gone with it. deleted: `app/(dash)/editing/**`, the whole `/editors` marketplace tree, `/e/<handle>`, the handoff room `app/handoff/**`, `components/editors/**`, and the five dash components only those pages mounted (`editing-forms`, `editing-requests`, `new-job-wizard`, `handoff-link`, `cut-player`, plus `components/job-files.tsx`). the rail row went, and so did every other door into it: the dashboard's `get an edit` button, its `in edit` tile, the `cuts waiting on you` attention card, the `edits` series on the activity chart, the `edit_jobs` read in `lib/dash-server.ts` and the one in `loadPerson`, the editor pill and Edit jobs panel on `/founder/people/<id>`, `/editing` in the proxy's protected list, and the stripe Connect half of `app/api/stripe/webhook` (`account.updated`, `STRIPE_CONNECT_WEBHOOK_SECRET`) which existed only to learn an editor's payout account had gone live.

**two things survived the section they were written in.** `recordDealAsset` / `deleteDealAsset` moved from the editing actions into `app/(dash)/deals/actions.ts`, because the deal's shelf is a brand's standing files and is reached from the deal's own edit page; it is titled **Brand shelf** now, not Editor shelf. and `lib/editing-files.ts` is load bearing for the shelf, the dropzone and the autoposting source check, so it is not going anywhere.

**`lib/` still carries the rest** — `lib/editing.ts`, `-handoff`, `-notify`, `-review*`, `lib/credits.ts`, `lib/editor-access.ts`, `lib/job-threads.ts` — under the same rule as every other removed feature: a copy from ugc flows has to land cleanly. what is NOT there any more is the three flags. a boolean promising to bring back pages that no longer exist is a lie; bringing editing back means copying the routes over.

**the api keys panel is gone from /settings.** the keys are the deploy's, in its env. `apiKey()` in `lib/api-keys.ts` still reads a stored workspace key first and `org_api_credentials` is empty, so the whole per-programme path is intact and unused. what came off is only the form: a panel of empty password fields reads as work the product is waiting on somebody for, and it is not. to bring it back, render `ApiKeysForm` behind an owner/admin seat and read `provider, hint` off that table.

**the manual refresh does not block the browser.** `refreshEverything` in `app/(dash)/deals/actions.ts` claims the allowance, reads the account list, and hands the sweep to `after()` — so the reply lands immediately saying "about five minutes", closing the tab cannot kill the scrape, and the "your numbers are fresh" email became the way anybody learns it finished rather than a nicety. the three checks that hand the allowance straight back (no session, no accounts, unreadable count) still run before the reply, but a sweep that reaches a provider and fails is refunded inside the callback, so that refund shows as a higher count on the next page load rather than in the sentence. `RefreshAll` polls `router.refresh()` every 45s for six minutes to fill the numbers in for whoever stayed.

## shared database, own cron, own path

the schema is ugc flows'. a schema change is written in the ugc flows repo (`../supabase/migrations/`) and applied through THAT repo's mcp; `supabase/migrations/` here is a read-only copy of the history for reference, and `supabase/bootstrap/` is what stood up the old project. never apply from here.

hosting: `NEXT_PUBLIC_SITE_URL=https://www.trycreatorempire.com/`, a bare origin, so `BASE_PATH` is `""` and there is no prefix anywhere. the prefixed shape (`https://www.ugcflows.com/creatorempire`, served through ugc flows' `zone_origin('creator-empire')` rewrite) is what this was built for and is not how it runs: this is its own domain now. `vercel.json` runs `/api/cron/refresh` hourly, because nobody else drains this org's sync queue; `CRON_SECRET` must be set or the route 503s. the machinery for the prefix is still in `lib/base-path.ts` and still correct if it ever moves back.

the session is NOT shared with ugc flows and cannot be: different supabase project, different cookie names (they derive from the api hostname), different apex. the auth cookie is widened to `.trycreatorempire.com` off SITE_URL by `lib/supabase/cookie-domain.ts`, which covers `www` and the apex and nothing else.

api keys: the programme pastes its own scrapecreators / upload-post / apify / rapidapi / youtube keys on /settings (owner and admin). `lib/api-keys.ts` resolves workspace key first, env second, always passing `CE_ORG_ID` as `p_org`, because a founder holds seats on many mentorships and "the caller's first seat" is the wrong org.

## sign in

google only. `components/auth-form.tsx` is one button, `/sign-up` redirects to `/login`, `/auth/callback` lands on `/dashboard`. a person gets in by holding a seat on `NEXT_PUBLIC_CE_ORG_ID` or by being on `admin_emails`; anyone else lands on `/account`, which says "not on the roster" and offers sign out. supabase side: project `xgiifxrxmtyklwglpewb`, google provider on, Site URL `https://www.trycreatorempire.com` — confirmed by `GET /auth/v1/callback?error=access_denied` and reading the `Location` header, which is the one call that answers "where does a half-finished sign-in end up". `https://www.trycreatorempire.com/auth/callback` has to be on that project's redirect allow list, and so does `http://localhost:3000/auth/callback` for dev.

## keeping it in step with ugc flows

this is a fork by copy. when a screen changes in ugc flows (`app/(dash)/**`, `components/dash/**`, `lib/**`), copy the file over. edited here and worth diffing before a copy: `lib/workspace.ts`, `lib/access.ts`, `lib/org.ts` (`CE_ORG_ID`), `lib/org-server.ts` (per member `micros`), `lib/content.ts`, `app/globals.css`, `app/page.tsx`, `app/(dash)/layout.tsx`, `components/dash/side-nav.tsx`, `components/auth-shell.tsx`, `app/(dash)/settings/page.tsx`, and the three files under `app/(dash)/agency/`. everything else is a straight copy.

for the product's own model (deals, bonus rules, the sync, autoposting, the bell) read the ugc flows repo's CLAUDE.md; it is the same code. its editing and editor-marketplace sections describe code that does not exist on this deploy any more.
