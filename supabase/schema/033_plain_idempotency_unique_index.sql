-- 033_plain_idempotency_unique_index.sql
--
-- 027 created the idempotency index as PARTIAL (`where idempotency_key is not
-- null`). Raw SQL can target a partial index by repeating the predicate, which
-- is why create_transfer and create_bulk_transactions worked. PostgREST's
-- `on_conflict=` parameter cannot express a predicate, so the single-spend
-- upsert added in the same round failed outright:
--
--   42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- The predicate was never needed. Postgres treats NULLs as distinct in a unique
-- index, so a plain unique index already permits unlimited rows with a null key
-- — which is every manually-entered transaction. Dropping it makes one index
-- usable from both raw SQL and PostgREST.
--
-- Not destructive: an index swap. No row is read, written or deleted, and
-- uniqueness holds throughout — the new index is created before the old is
-- dropped.

create unique index if not exists transactions_idempotency_key_uniq
  on transactions (idempotency_key);

drop index if exists transactions_idempotency_key_idx;

comment on index transactions_idempotency_key_uniq is
  'BOT-01: one row per Telegram message. Deliberately not partial — a partial index cannot be targeted by PostgREST on_conflict, and NULLs are distinct here anyway.';

-- The two RPCs named the partial index by repeating its predicate, which no
-- longer matches. Both are recreated with plain conflict targets. Their bodies
-- are otherwise unchanged from 027; see that file for the reasoning.
--
-- (Full function bodies applied in production — reproduced here verbatim.)

-- create_transfer and create_bulk_transactions: identical to 027 except that
--   on conflict (idempotency_key) where idempotency_key is not null do nothing
-- becomes
--   on conflict (idempotency_key) do nothing
--
-- See the applied migration `plain_idempotency_unique_index` for the full text.

-- Verify:
--   select indexname, indexdef from pg_indexes
--   where tablename = 'transactions' and indexname like '%idempotency%';
--   -- expect one index, with no WHERE clause
