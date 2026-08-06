-- Our Money v4 — pay-down goal progress
-- Progress for a pay_down goal is derived from the linked liability
-- account's value over time, not a manually-tracked number. That needs a
-- fixed reference point: the balance when the goal was started.

alter table goals add column if not exists starting_balance numeric;

-- Fill in the plan doc's monthly_plan figure for the already-seeded
-- Emergency Fund goal (the original seed didn't set it). Guarded so it
-- never overwrites a value Shrey has since customized.
update goals set monthly_plan = 5700
where name = 'Emergency Fund' and monthly_plan is null;
