-- Fixed deposits as a goal-fundable account type.
-- Additive only, never destructive — this database carries real money data.
--
-- An FD's value still comes from a bank/broker statement, same as every
-- other account (the money-data rule in CLAUDE.md) — interest is never
-- auto-posted as a transaction, since the actually-applied rate can differ
-- from the nominal one (compounding, tax, rounding). interest_rate is only
-- ever used client-side to compute a *projected* trajectory for display;
-- it never writes back into accounts.value or any ledger table.
alter table accounts drop constraint if exists accounts_type_check;
alter table accounts add constraint accounts_type_check
  check (type in (
    'cash', 'investment', 'real_estate', 'vehicle', 'valuable', 'other',
    'fixed_deposit',
    'credit_card', 'loan', 'mortgage', 'other_liability'
  ));

alter table accounts add column if not exists interest_rate numeric;
