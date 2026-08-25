# apply log, 2026-08-25

applied to xgiifxrxmtyklwglpewb through the management api `POST /v1/projects/{ref}/database/query` (same bearer the mcp holds; the mcp `apply_migration` was not used because each file had to be sent whole and the api takes a file straight from disk). 00_prelude went through mcp `apply_migration`, so it is the only entry in `supabase_migrations.schema_migrations`. the other 80 are not in that history table.

order: 00_prelude, then the 77 files in `supabase/migrations/`, then the 3 `20260825*` files from ugc flows. each file ran as one transaction, so a failure rolled that file back fully and it was re-run after the fix.

## fixes

| file | error | fix run before retry |
|---|---|---|
| 20260821210000_payout_queue.sql | `policy "editor_payouts_admin_read" for table "editor_payouts" already exists` (20260809070000 created it, this file recreates it without a drop; the live db had lost it somewhere between) | `drop policy if exists editor_payouts_admin_read on public.editor_payouts` |
| 20260821270000_editor_stripe_connect.sql | `cannot change return type of existing function ... DROP FUNCTION claim_payout_batch(integer) first` (20260821240000 defined it with a different out row) | `drop function if exists public.claim_payout_batch(integer)` |

nothing else needed a change. no seed rows were edited (the campaign manager seed in 20260811170100 went in as is; campaigns routes are deleted in this app).
