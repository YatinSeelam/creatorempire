@AGENTS.md

# creator empire

the creator empire app: a standalone deploy of the ugc flows dashboard for ONE workspace, on its OWN supabase project (`xgiifxrxmtyklwglpewb`, the `.mcp.json` here points at it). since 2026-08-25 it no longer shares a database with ugc flows. next 16 app router + react 19 + tailwind 4 + supabase. package name: `creatorempire`.

this folder was cut from the ugc flows repo on 2026-08-25 and is meant to live in its own github repo and its own vercel project. the code is the same product with the marketing, the self serve plan and the agency builder removed, and the whole app pinned to one org.

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

## own database, own cron

the schema is a copy of ugc flows', stood up from `supabase/bootstrap/` (the 80 migrations concatenated in order, see its README and AUDIT.md). `supabase/migrations/` is the same history split per file, for reading. a schema change here is written as a new file in `supabase/migrations/` and applied through the mcp (`apply_migration`), same workflow as ugc flows, and it does not flow back to ugc flows on its own.

`vercel.json` runs `/api/cron/refresh` hourly on this deploy, because nobody else drains this project's sync queue. `CRON_SECRET` must be set or the route 503s.

## sign in

google only. `components/auth-form.tsx` is one button, `/sign-up` redirects to `/login`, `/auth/callback` lands on `/dashboard`. a person gets in by holding a seat on `NEXT_PUBLIC_CE_ORG_ID` or by being on `admin_emails`; anyone else lands on `/account`, which says "not on the roster" and offers sign out. supabase side: google provider on, google cloud client redirect uri `https://xgiifxrxmtyklwglpewb.supabase.co/auth/v1/callback`, and `<site url>/auth/callback` on the redirect allow list.

## keeping it in step with ugc flows

this is a fork by copy. when a screen changes in ugc flows (`app/(dash)/**`, `components/dash/**`, `lib/**`), copy the file over. edited here and worth diffing before a copy: `lib/workspace.ts`, `lib/access.ts`, `lib/org.ts` (`CE_ORG_ID`), `lib/org-server.ts` (per member `micros`), `lib/content.ts`, `app/globals.css`, `app/page.tsx`, `app/(dash)/layout.tsx`, `components/dash/side-nav.tsx`, `components/auth-shell.tsx`, `app/(dash)/settings/page.tsx`, and the three files under `app/(dash)/agency/`. everything else is a straight copy.

for the product's own model (deals, bonus rules, the sync, autoposting, editing, the bell) read the ugc flows repo's CLAUDE.md; it is the same code.
