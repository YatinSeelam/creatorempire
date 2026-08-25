# bootstrap

full ugc flows schema for a fresh supabase project. apply in filename order via mcp `execute_sql` (or psql). `00_prelude.sql` is hand written (the schema/tables that only ever existed live: private, admin_emails, profiles, subscriptions, is_admin, signup trigger); `01`..`05` are the ordered concatenation of `supabase/migrations/*.sql` (77) plus the 3 `20260825*` files from the ugc flows repo, split under 100KB each. read AUDIT.md before applying, and its "after apply" list once done.

order:
- 00_prelude.sql (6KB)
- 01_20260808120000_to_20260809060000.sql (87KB)
- 02_20260809070000_to_20260811173000.sql (92KB)
- 03_20260811180000_to_20260821220000.sql (90KB)
- 04_20260821230000_to_20260824100000.sql (92KB)
- 05_20260825010000_to_20260825030000.sql (4KB)
- 99_seed.sql (0KB)
