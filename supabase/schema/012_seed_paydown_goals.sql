-- Our Money v4 — seed the 3 missing pay-down goals (Taskiv #20)
-- The 010_goals_pay_down migration added the `starting_balance` column but
-- never inserted the pay_down rows themselves — verified in production
-- 2026-08-07, `goals` table had only "Emergency Fund".
--
-- linked_account_id is intentionally left null here: real liability
-- accounts don't exist yet (Taskiv #6, Shrey's data-entry task). Once he
-- enters the car loan / CC EMI accounts, link each goal to its account
-- manually via the Goals screen's edit form — no migration needed for that
-- step. starting_balance likewise needs the real current balance at seed
-- time; left null so PayDownCard/GoalDetail fall back safely (see
-- src/screens/Goals.jsx) rather than showing a false 0%/100% progress.

-- target_amount is not-null in the schema but is only meaningful for
-- save_up goals (see GoalForm.jsx) — pay_down progress is derived from
-- starting_balance/linked account value instead. 0 until a real account
-- is linked and GoalForm's own save path back-fills it from account.value.
insert into goals (name, kind, icon, target_amount, monthly_plan, target_date, priority)
select '0% CC Loan', 'pay_down', '💳', 0, 5207, '2026-12-31', 2
where not exists (select 1 from goals where name = '0% CC Loan');

insert into goals (name, kind, icon, target_amount, monthly_plan, target_date, priority)
select 'Car Down-Payment CC EMI', 'pay_down', '💳', 0, 1542, '2027-05-31', 3
where not exists (select 1 from goals where name = 'Car Down-Payment CC EMI');

insert into goals (name, kind, icon, target_amount, monthly_plan, target_date, priority)
select 'Car Loan', 'pay_down', '🚗', 0, 2194, null, 4
where not exists (select 1 from goals where name = 'Car Loan');
