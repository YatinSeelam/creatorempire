-- The flow key leak, applied SEPARATELY and AFTER the code that stops
-- selecting `*` from orgs is live (lib/workspace.ts, lib/org-server.ts read an
-- explicit column list as of the same change). Applying this before that
-- deploy makes every `select("*")` on orgs fail with "permission denied", which
-- is the whole agency layer going dark for the length of a build.
--
-- The hole: 20260811180000_org_flow_key.sql revoked select on the COLUMN, but
-- authenticated still held a table-level SELECT on orgs, and a column revoke
-- does not narrow a table grant. Any creator on any roster could
-- `select flow_api_key from orgs`, and the app's own `select("*")` pulled the
-- key into the branding page's client props. Table-level select goes; a
-- column list without the key comes back.

-- ------------------------------------------------------- 1. the flow key leak
revoke select on public.orgs from authenticated;
grant select (
  id, slug, name, logo_url, wordmark_url, favicon_url,
  accent_hex, accent_dark_hex, accent_soft_hex, rail_hex,
  features, support_email, custom_domain, owner_id,
  flow_key_set_at, created_at, updated_at
) on public.orgs to authenticated;

-- belt and braces: the column revoke from the flow-key migration, restated so
-- a future `grant select on orgs` re-run has to be deliberate about the key.
revoke select (flow_api_key) on public.orgs from anon, authenticated;

