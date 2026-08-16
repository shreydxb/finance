-- Our Money v4 — statement-cycle fields on accounts
--
-- Backs the credit-card section on the Accounts screen: a card's limit, when
-- its statement closes and when payment is due. Taskiv #75.
--
-- All three are nullable and additive. They are only meaningful for
-- `type = 'credit_card'` rows, but the constraints are deliberately NOT
-- conditional on type — a type-conditional check would have to be evaluated
-- against the 40+ non-card rows, and every one of them holds null here anyway.
--
-- Day-of-month is stored as a plain 1–31 smallint rather than a date. Cards
-- state their cycle as "closes on the 17th", not as a calendar date, and a
-- date would go stale every month. Callers resolve it against the month they
-- care about.
--
-- Note on 29/30/31: a card whose statement day is 31 has no such day in
-- February. Resolving that is the caller's job (clamp to the month's last
-- day); the column stores what the bank actually says.

alter table accounts add column if not exists statement_day smallint
  check (statement_day is null or (statement_day >= 1 and statement_day <= 31));

alter table accounts add column if not exists due_day smallint
  check (due_day is null or (due_day >= 1 and due_day <= 31));

-- Nullable on purpose: an unknown limit must stay distinguishable from a zero
-- limit, since utilisation against 0 is meaningless rather than 100%.
alter table accounts add column if not exists credit_limit numeric
  check (credit_limit is null or credit_limit > 0);
