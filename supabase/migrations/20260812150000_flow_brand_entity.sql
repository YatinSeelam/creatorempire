-- Flow gains a brand proposal. `propose_brand_edit` records
-- target_entity = 'brand', which the original check constraint on ai_proposals
-- refused, so a rename card could not be written at all.
--
-- Renaming a brand renames it on every deal that points at it, which is what
-- somebody usually means by "that brand is spelled wrong". Same safety model as
-- every other write: the row is a card, a human accepts it, and the accept runs
-- `updateBrand` — the same server action the brand form on the deal's edit page
-- runs, under the same RLS.

alter table public.ai_proposals
  drop constraint if exists ai_proposals_target_entity_check;

alter table public.ai_proposals
  add constraint ai_proposals_target_entity_check
    check (target_entity in ('deal', 'brand', 'bonus_rule', 'deal_account', 'calendar_note'));
