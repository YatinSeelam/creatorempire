-- Flow gains a delete proposal. `propose_deal_delete` records op = 'delete',
-- which the original check constraint on ai_proposals refused. Same safety
-- model as every other write: the row is a card, a human accepts it, and the
-- accept runs the same server action the delete button on the deal's edit
-- page runs. Nothing auto-applies a delete; it is classified money tier.

alter table public.ai_proposals
  drop constraint if exists ai_proposals_op_check;

alter table public.ai_proposals
  add constraint ai_proposals_op_check check (op in ('create', 'update', 'delete'));
