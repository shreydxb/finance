-- Our Money v4 — transaction splits
-- A split transaction is stored as 2+ rows in `transactions` sharing the same
-- split_group_id, each with its own category and amount (summing to the total
-- the user entered). Additive-only: nullable column, no backfill needed.

alter table transactions add column if not exists split_group_id uuid;
