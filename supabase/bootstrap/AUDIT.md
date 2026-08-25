# bootstrap audit (2026-08-25)

bundle = `00_prelude.sql` (hand written) + `01`..`05` (the 80 migration files concatenated in filename order, split under 100KB each). nothing applied yet.

## a. objects referenced but created by no migration

these four exist only in the live ugc flows db (docs/02-DATA-MODEL.md line 16 says so). `00_prelude.sql` creates them; without it `01_*.sql:966` fails on the first `private.is_admin()` policy.

- schema `private` (every rls helper lives there; first created function is `private.admin_view` at 02:453, first USE is 01:966)
- table `public.admin_emails` (first use 01:966 via `is_admin`; `role` column added at 04:15, policy at 04:104, trigger at 04:142)
- function `private.is_admin()` (86 uses from 01 on, first created at 04:28 as v2) and `public.am_i_admin()` (used 01:1735, 01:1738, app `.rpc("am_i_admin")`)
- table `public.profiles` (policies at 01:1020, 02:868; columns added 04:1465; read by `admin_people` view 02:83 with `email, full_name, avatar_url, handle, niche, created_at`; app updates `full_name, handle, niche, notify_deals, notify_edits, notify_posts, phone, avatar_url`)
- table `public.subscriptions` (policy 02:64; stripe webhook upserts `user_id, status, paid_at, stripe_customer_id, stripe_subscription_id, current_period_end, last_event_id, updated_at`; lib/billing.ts reads `status, paid_at`)
- the auth signup trigger that fills `profiles` (no migration creates one; prelude adds `private.handle_new_user` on `auth.users` insert + email change mirror)

everything else checks out: every `alter table`, `create policy ... on`, `references`, `create trigger ... on` and `grant ... on` target is created earlier in the bundle. every `private.*` helper called is created (admin_view, managed_org_ids, my_org_ids, org_member_ids, org_view, seat_org_owner, deals_check_org, is_org_member, org_deal_ids, org_members_release_deals, org_video_ids, protect_owner_seat_del/role, stamp_org_override, granted_role, is_admin, protect_last_admin(_update), orgs_guard_template).

app `.from("...")` names missing from the bundle: only `admin_emails`, `profiles`, `subscriptions` (prelude). app `.rpc("...")` missing: only `am_i_admin` (prelude).

## b. seeds that are ugc flows specific

- 02:1937 `insert into public.campaign_managers` and 02:1975 `campaign_deals`, 02:2016 `campaign_deal_managers` (20260811170100_campaigns_seed.sql): ugc flows' own campaign manager roster (discord handles). harmless but junk here; the campaigns routes are deleted in this deploy. skip that file or `truncate campaign_deal_managers, campaign_deals, campaign_managers` after.
- 04:150 `update public.admin_emails set role = 'creator' where email in ('createwadrianugc@gmail.com', 'ugc.raf.ugc@gmail.com')`: no-op on an empty table. fine.
- 01:912 `api_pricing` seed for scrapecreators: wanted.
- no `insert into admin_emails` anywhere. the founder row is a manual insert after apply: `insert into public.admin_emails (email, role) values ('<you>', 'founder');`
- the only ugcflows.com mentions are comments (01:496, 01:1675, 02:2849, 02:2979, 04:7663 by bundle line). no hardcoded project refs.

## c. transactions / psql commands

- none. no `begin;` / `commit;` wrappers, no `\` meta commands. the `begin` hits are plpgsql bodies. each file can go through mcp `execute_sql` as one batch (the mcp wraps it in its own transaction; a failure rolls the whole file back, so re-run the file after fixing).

## d. hosts / refs

- none in sql. `auth.ugcflows.com` only appears in the app's `.env.local` second block (the "not done" ugc flows leftovers), not in this bundle.

## e. extensions, cron, pg_net

- `create extension if not exists pgcrypto` (01:16, and prelude). nothing else.
- no `cron.*`, no `pg_net`, no `net.http`. the sync is vercel cron hitting `/api/cron/refresh`.

## f. storage buckets

created by the bundle itself (`insert into storage.buckets`):

| id | public | size limit |
|---|---|---|
| portfolio | yes | 60MB |
| autopost | yes | 200MB |
| editing-assets | no (mime list cleared at 04:1774) | 500MB |
| variations | yes | 500MB |
| brand-logos | yes | 1MB |
| audio-library | yes | 500MB |

storage policies come with them in the same files. nothing to create by hand.

## g. supabase_migrations

- nothing in the bundle touches `supabase_migrations`. applying via `execute_sql` records no history; if you want the dashboard's migration list to match, apply each original file with `apply_migration` instead (80 calls) or insert the 80 versions into `supabase_migrations.schema_migrations` afterwards.

## after apply, by hand

1. `insert into public.admin_emails (email, role) values ('<founder email>', 'founder');`
2. create the org: `insert into public.orgs (name, slug, owner_id) values ('creator empire', 'creator-empire', '<founder uuid>') returning id;` (the trigger seats the owner). check `orgs` columns in 02_*.sql (20260810190000_orgs_white_label) for anything not-null before running.
3. set `NEXT_PUBLIC_CE_ORG_ID` to that id.
4. auth: google provider on, site url + `/auth/callback` on the redirect allow list.
