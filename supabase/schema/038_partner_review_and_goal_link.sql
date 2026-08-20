-- Our Money v4 — Taskiv #24 (Phase 2 backlog), first two pieces:
-- assign-a-spend-to-partner-for-review, and link-a-spend-to-a-goal.
--
-- Both are lightweight tags on transactions, additive and nullable, deliberately
-- NOT feeding any money total — assigned_to never changes what a transaction
-- costs, and goal_id is a display-only association, not a contribution.
-- Contributions that actually count toward a goal's progress still go through
-- goal_contributions / create_goal_contribution (see src/lib/goals.js) — this
-- column exists so a household member can say "this Ikea run was for the New
-- Sofa goal" without pretending it was a transfer into a dedicated account.

-- Free text, matching how `owner` is already stored (no separate people
-- table exists yet), restricted to the two real people — never 'Joint',
-- since assigning a review to "the household" isn't a real request.
alter table transactions add column if not exists assigned_to text
  check (assigned_to is null or assigned_to in ('Shrey', 'Tarika'));

-- on delete set null, not cascade: deleting a goal should not silently
-- delete or corrupt the transactions that were once linked to it — it
-- should just stop showing the badge.
alter table transactions add column if not exists goal_id uuid
  references goals(id) on delete set null;

create index if not exists transactions_assigned_to_idx on transactions (assigned_to) where assigned_to is not null;
create index if not exists transactions_goal_id_idx on transactions (goal_id) where goal_id is not null;
