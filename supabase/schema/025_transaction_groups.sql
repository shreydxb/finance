-- 025_transaction_groups.sql — DATA-01
--
-- `split_group_id` came from 006, where it meant one thing: the lines of a
-- single purchase divided across categories. Two later features reused the
-- column for different relationships without saying so:
--
--   020 (transfers)   — the two sides of a money movement share one id
--   round2 §2 (bulk)  — several *unrelated* spends from one message share one id
--
-- Nothing records which of the three a given id represents, so the frontend
-- guesses, and it guesses "category split" every time
-- (`TransactionList.groupBySplit`). The consequences are not cosmetic:
--
--   - A transfer renders as a split with a doubled positive total.
--   - A bulk batch collapses rows with different dates, accounts, currencies
--     and notes into one row showing only the first one's values.
--   - Editing that row takes the base fields from the first line, deletes the
--     whole group, and recreates it — silently rewriting the others.
--   - Deleting it removes the entire transfer or batch.
--
-- This makes the relationship explicit, and renames the column so its name
-- stops asserting something untrue.
--
-- ---------------------------------------------------------------------------
-- Nothing to migrate
-- ---------------------------------------------------------------------------
--
-- Verified against production 12 Aug 2026: **zero rows have a non-null
-- split_group_id**. All three groups that existed belonged to the `[TEST]`
-- fixture set deleted earlier that day, so no real category split, transfer or
-- bulk batch has ever been recorded. There is no ambiguous historical data to
-- classify and no exceptions report to produce — the backfill below is written
-- to be correct anyway, so this file is still right if applied to a database
-- that does have rows.
--
-- Additive only. No column is dropped: `split_group_id` is left in place,
-- unused and documented as deprecated.

begin;

alter table transactions
  add column if not exists transaction_group_id uuid,
  add column if not exists group_kind text,
  add column if not exists transfer_direction text;

-- Carry over anything that exists. On production this moves zero rows.
-- 'category_split' is the honest default: it is what the column meant in 006,
-- and the two later reuses postdate any data this would touch.
update transactions
set transaction_group_id = split_group_id,
    group_kind = 'category_split'
where split_group_id is not null and transaction_group_id is null;

-- A group id without a kind is exactly the ambiguity this migration removes,
-- so the two must travel together.
alter table transactions drop constraint if exists transactions_group_kind_valid;
alter table transactions add constraint transactions_group_kind_valid check (
  group_kind is null or group_kind in ('category_split', 'transfer', 'bulk_batch')
);

alter table transactions drop constraint if exists transactions_group_pairing;
alter table transactions add constraint transactions_group_pairing check (
  (transaction_group_id is null and group_kind is null)
  or (transaction_group_id is not null and group_kind is not null)
);

-- Direction only means anything for a transfer, and a transfer row without one
-- cannot say which account the money left.
alter table transactions drop constraint if exists transactions_transfer_direction_valid;
alter table transactions add constraint transactions_transfer_direction_valid check (
  (group_kind = 'transfer' and transfer_direction in ('out', 'in'))
  or (group_kind is distinct from 'transfer' and transfer_direction is null)
);

create index if not exists transactions_group_idx
  on transactions (transaction_group_id)
  where transaction_group_id is not null;

comment on column transactions.transaction_group_id is
  'Links rows that belong to one logical operation. Always paired with group_kind — never infer the relationship from the id alone.';
comment on column transactions.group_kind is
  'category_split: lines of one purchase across categories. transfer: the two sides of a money movement (not a spend). bulk_batch: independent spends that arrived in one message.';
comment on column transactions.transfer_direction is
  'out = money left this account, in = money arrived. Only set when group_kind = transfer.';
comment on column transactions.split_group_id is
  'DEPRECATED (025). Superseded by transaction_group_id + group_kind, which record what the relationship actually is. Retained, unused, because this schema is additive-only.';

commit;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--
--   -- Expect zero: every grouped row must declare its kind.
--   select count(*) from transactions
--   where (transaction_group_id is null) <> (group_kind is null);
--
--   -- Expect zero: transfers must have a direction, others must not.
--   select count(*) from transactions
--   where (group_kind = 'transfer') <> (transfer_direction is not null);
--
--   -- Shape of every group.
--   select group_kind, count(*) rows, count(distinct transaction_group_id) groups
--   from transactions where transaction_group_id is not null group by group_kind;
--
-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
--
--   alter table transactions
--     drop constraint if exists transactions_group_kind_valid,
--     drop constraint if exists transactions_group_pairing,
--     drop constraint if exists transactions_transfer_direction_valid;
--
-- The columns can stay: they are nullable and nothing else depends on them.
-- Reverting the application code is enough to restore the old behaviour.
