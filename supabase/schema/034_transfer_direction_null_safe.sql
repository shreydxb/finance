-- 034_transfer_direction_null_safe.sql
--
-- Found by the new database-integration suite (Taskiv #101), not by any
-- production incident: `transactions_transfer_direction_valid` (025) used
-- `transfer_direction in ('out', 'in')` to require a direction on a transfer
-- row. Postgres CHECK constraints treat a NULL result as satisfied, not
-- violated — and `null in ('out', 'in')` evaluates to NULL, not false. So a
-- row with `group_kind = 'transfer'` and `transfer_direction = null` passed
-- the constraint that was supposed to block exactly that.
--
-- Nothing in the app hits this today: `create_transfer` (027) always sets
-- both sides' direction explicitly, and it's the only writer of transfer
-- rows. This closes the gap in the constraint itself, so a future writer
-- can't reintroduce the bug DATA-01 already fixed once.

begin;

alter table transactions drop constraint if exists transactions_transfer_direction_valid;
alter table transactions add constraint transactions_transfer_direction_valid check (
  (group_kind = 'transfer' and transfer_direction is not null and transfer_direction in ('out', 'in'))
  or (group_kind is distinct from 'transfer' and transfer_direction is null)
);

comment on constraint transactions_transfer_direction_valid on transactions is
  'A transfer row must have out/in; every other row must have none. Explicit IS NOT NULL so a null direction cannot pass via CHECK''s NULL-is-satisfied semantics — see 034.';

commit;

-- Verify:
--   insert into transactions (date, amount, account_id, transaction_group_id, group_kind)
--   values (current_date, 1, '<any account id>', gen_random_uuid(), 'transfer');
--   -- must now raise transactions_transfer_direction_valid; before 034 it silently succeeded.
--
-- Rollback: re-run 025's version of the same constraint.
